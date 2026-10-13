// Links the actual installed (or isolated candidate) Nitro parser and md4c C
// source. The md_parse shim injects a failure with an open native paragraph for
// the partial-AST case; normal cases call the unmodified md4c implementation.
#include "MD4CParser.hpp"
#include "md4c.h"
#include <cstdint>
#include <iostream>
#include <vector>

using NitroMarkdown::MarkdownNode;
using NitroMarkdown::MD4CParser;
using NitroMarkdown::NodeType;
using NitroMarkdown::ParserOptions;

static int failures;
static bool abortNextParse;

extern "C" int t3_real_md_parse(const MD_CHAR *, MD_SIZE, const MD_PARSER *, void *);
extern "C" int md_parse(const MD_CHAR *text, MD_SIZE size, const MD_PARSER *parser, void *userdata)
{
  if (!abortNextParse) return t3_real_md_parse(text, size, parser, userdata);
  abortNextParse = false;
  // A real prefix parse supplies the first paragraph. Then the real parser
  // callbacks receive a second paragraph's pending text, without a close event.
  // This models md_parse failing while its native AST stack still has open nodes.
  constexpr MD_SIZE prefixLength = 17;
  t3_real_md_parse(text, prefixLength, parser, userdata);
  parser->enter_block(MD_BLOCK_P, nullptr, prefixLength, userdata);
  parser->text(MD_TEXT_NORMAL, text + prefixLength, 16, userdata);
  return 1;
}

static void expect(bool condition, const char *message)
{
  if (!condition) {
    ++failures;
    std::cerr << "FAIL: " << message << '\n';
  }
}
static std::string text(const std::shared_ptr<MarkdownNode> &root)
{
  std::string result;
  std::vector<std::shared_ptr<MarkdownNode>> pending{root};
  while (!pending.empty()) {
    auto node = std::move(pending.back());
    pending.pop_back();
    if (node->content) result += *node->content;
    for (auto iterator = node->children.rbegin(); iterator != node->children.rend(); ++iterator)
      pending.push_back(*iterator);
  }
  return result;
}
struct Footprint { size_t nodes = 0; size_t bytes = 0; };
static Footprint footprint(const std::shared_ptr<MarkdownNode> &root)
{
  Footprint result;
  std::vector<std::shared_ptr<MarkdownNode>> pending{root};
  while (!pending.empty()) {
    auto node = std::move(pending.back());
    pending.pop_back();
    ++result.nodes;
    result.bytes += sizeof(MarkdownNode) + node->children.capacity() * sizeof(std::shared_ptr<MarkdownNode>);
    for (const auto *field : {&node->content, &node->href, &node->title, &node->alt, &node->language}) {
      if (!field->has_value()) continue;
      const auto &value = field->value();
      const auto data = reinterpret_cast<uintptr_t>(value.data());
      const auto start = reinterpret_cast<uintptr_t>(&value);
      // Inline short-string storage is already included in sizeof(MarkdownNode).
      if (data < start || data >= start + sizeof(value)) result.bytes += value.capacity() + 1;
    }
    for (const auto &child : node->children) pending.push_back(child);
  }
  return result;
}

static const ParserOptions options{true, false, true};

static void completedTreeReleases()
{
  MD4CParser parser;
  std::string source;
  for (int index = 0; index < 5000; ++index) source += "- **File**: [app.tsx](src/app.tsx) item\n";
  auto result = parser.parse(source, options);
  const auto size = footprint(result);
  expect(size.nodes > 30000, "fixture creates a meaningful large native AST");
  std::weak_ptr<MarkdownNode> weak = result;
  std::weak_ptr<MarkdownNode> childWeak = result->children.back();
  result.reset();
  const size_t retainedBytes = weak.expired() ? 0 : size.bytes;
  expect(weak.expired(), "parser does not keep the completed AST after its caller releases it");
  expect(childWeak.expired(), "completed child nodes release with the caller's tree");
  std::cout << "completed tree: " << size.nodes << " nodes; " << retainedBytes
            << " native node/buffer bytes retained after caller release\n";
}

static void returnedTreeSurvivesNextParse()
{
  MD4CParser parser;
  auto first = parser.parse("**First** paragraph", options);
  auto second = parser.parse("Second paragraph", options);
  expect(first->type == NodeType::Document && text(first) == "First paragraph",
         "returned AST remains usable after another parse");
  expect(text(second) == "Second paragraph", "later parse returns independent content");
  std::weak_ptr<MarkdownNode> firstWeak = first, secondWeak = second;
  first.reset();
  expect(firstWeak.expired() && !secondWeak.expired(), "each caller owns its returned tree independently");
  second.reset();
  expect(secondWeak.expired(), "latest returned tree also releases while parser remains alive");
}

static void partialFailureTreeSurvives()
{
  MD4CParser parser;
  abortNextParse = true;
  auto partial = parser.parse("First paragraph\n\nSecond paragraph\n\nNever parsed", options);
  expect(partial->type == NodeType::Document, "native failure returns a partial document");
  expect(text(partial) == "First paragraphSecond paragraph", "partial failure keeps completed and pending text");
  std::weak_ptr<MarkdownNode> weak = partial;
  std::weak_ptr<MarkdownNode> openParagraph = partial->children.back();
  partial.reset();
  expect(weak.expired(), "partial failure does not retain the document through the open node stack");
  expect(openParagraph.expired(), "partial failure clears every open child from the native node stack");
  expect(text(parser.parse("Recovered", options)) == "Recovered", "parser remains reusable after failure");
}

static void emptyAndUnicodeDocuments()
{
  MD4CParser parser;
  auto empty = parser.parse("", options);
  expect(empty->type == NodeType::Document && empty->children.empty(), "empty document shape is preserved");
  std::weak_ptr<MarkdownNode> weak = empty;
  empty.reset();
  expect(weak.expired(), "empty document is not kept by the reusable parser");
  auto unicode = parser.parse("Hello 😀 **café**", options);
  expect(text(unicode) == "Hello 😀 café", "UTF-8 content is preserved after parser cleanup");
}

static void existingURLBehavior()
{
  MD4CParser parser;
  auto result = parser.parse("http://localhost:3000/a_(b)?q=x:y#part:2", options);
  auto paragraph = result->children.at(0);
  auto link = paragraph->children.at(0);
  expect(link->type == NodeType::Link && link->href == "http://localhost:3000/a_(b)?q=x:y#part:2",
         "existing patched URL parsing remains intact");
}

int main()
{
  completedTreeReleases();
  returnedTreeSurvivesNextParse();
  partialFailureTreeSurvives();
  emptyAndUnicodeDocuments();
  existingURLBehavior();
  std::cout << "Nitro parser: 5 cases; " << failures << " failed assertions\n";
  return failures == 0 ? 0 : 1;
}
