#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#include <chrono>
#include <memory>
#include <string>
#include <vector>

// Run the production drawRect method against real UITextView/TextKit. These
// adapters replace only React state/conversion and attachment transport.
namespace facebook::react {
struct T3MarkdownTextProps { int numberOfLines = 0; };
struct AttachmentRange { size_t location; size_t length; std::string imageUri; };
struct StateData {
  NSAttributedString *__strong attributedString;
  std::vector<int> paragraphStyleRanges;
  std::vector<AttachmentRange> attachmentRanges;
};
struct FixtureState {
  StateData data;
  const StateData &getData() const { return data; }
};
struct FixtureEmitter { virtual ~FixtureEmitter() = default; };
static size_t emittedEvents = 0, copiedLines = 0, copiedBytes = 0;
struct T3MarkdownTextEventEmitter : FixtureEmitter {
  struct OnTextLayout { int target; std::vector<std::string> lines; };
  void onTextLayout(const OnTextLayout &event) const {
    emittedEvents++;
    copiedLines += event.lines.size();
    for (const auto &line : event.lines) copiedBytes += line.size();
  }
};
}
using namespace facebook::react;

static NSAttributedString *RCTNSAttributedStringFromAttributedString(NSAttributedString *value) { return value; }
static void RCTApplyBaselineOffset(NSMutableAttributedString *) {}
static void T3MarkdownTextApplyParagraphStyles(NSMutableAttributedString *, const std::vector<int> &) {}
static void T3MarkdownTextApplyAttachments(NSMutableAttributedString *, const std::vector<AttachmentRange> &, NSDictionary *) {}
static NSDictionary *T3ContextChipPayload(NSString *uri) {
  return [uri isEqualToString:@"fixture:chip"] ? @{@"label": @"report.md", @"interactive": @YES} : nil;
}

@interface CountingLayoutManager : NSLayoutManager
@property(nonatomic) NSUInteger enumerationCalls;
@property(nonatomic) NSUInteger fullDocumentEnumerationCalls;
@property(nonatomic) NSUInteger lineFragments;
@property(nonatomic) NSUInteger characterRangeCalls;
@end
@implementation CountingLayoutManager
- (void)enumerateLineFragmentsForGlyphRange:(NSRange)range usingBlock:(void (^)(CGRect, CGRect, NSTextContainer *, NSRange, BOOL *))block {
  self.enumerationCalls++;
  if (range.length > 0 && range.length >= self.textStorage.length) self.fullDocumentEnumerationCalls++;
  [super enumerateLineFragmentsForGlyphRange:range usingBlock:^(CGRect rect, CGRect usedRect, NSTextContainer *container, NSRange glyphRange, BOOL *stop) {
    self.lineFragments++;
    block(rect, usedRect, container, glyphRange, stop);
  }];
}
- (NSRange)characterRangeForGlyphRange:(NSRange)range actualGlyphRange:(NSRangePointer)actual {
  self.characterRangeCalls++;
  return [super characterRangeForGlyphRange:range actualGlyphRange:actual];
}
@end

@interface T3MarkdownTextRun : UIView
@property(nonatomic, copy) NSString *text;
@property(nonatomic) BOOL contextChipInteractive;
- (BOOL)hasContextMenu;
@end
@implementation T3MarkdownTextRun
- (BOOL)hasContextMenu { return NO; }
@end

@interface T3ContextChipAccessibilityElement : UIAccessibilityElement
@property(nonatomic, weak) T3MarkdownTextRun *run;
@end
@implementation T3ContextChipAccessibilityElement
@end

@interface T3MarkdownText : UIView {
@public
  std::shared_ptr<FixtureState> _state;
  std::shared_ptr<T3MarkdownTextProps> _props;
  std::shared_ptr<FixtureEmitter> _eventEmitter;
  UITextView *_textView;
  UIView *_view;
  NSDictionary *_attachmentImages;
  NSArray *_contextAccessibilityElements;
  BOOL _textLayoutNeedsUpdate;
  BOOL _suppressSelectionChange;
  NSUInteger fixtureImageLoads;
}
- (instancetype)initWithText:(NSString *)text;
- (void)loadAttachmentImages:(const std::vector<AttachmentRange> &)ranges;
- (T3MarkdownTextRun *)childForCharacterRange:(NSRange)range;
@end

@implementation T3MarkdownText
- (instancetype)initWithText:(NSString *)text {
  if ((self = [super initWithFrame:CGRectMake(0, 0, 320, 100)])) {
    _view = [[UIView alloc] initWithFrame:self.bounds];
    CountingLayoutManager *layout = [CountingLayoutManager new];
    NSTextStorage *storage = [NSTextStorage new];
    [storage addLayoutManager:layout];
    NSTextContainer *container = [[NSTextContainer alloc] initWithSize:CGSizeMake(320, CGFLOAT_MAX)];
    [layout addTextContainer:container];
    _textView = [[UITextView alloc] initWithFrame:_view.frame textContainer:container];
    _textView.editable = NO;
    _textView.selectable = YES;
    _textView.font = [UIFont systemFontOfSize:14];
    _state = std::make_shared<FixtureState>();
    _state->data.attributedString = [[NSAttributedString alloc] initWithString:text attributes:@{NSFontAttributeName: _textView.font}];
    _props = std::make_shared<T3MarkdownTextProps>();
    _eventEmitter = std::make_shared<T3MarkdownTextEventEmitter>();
    _textLayoutNeedsUpdate = YES;
    _attachmentImages = @{};
  }
  return self;
}
- (void)loadAttachmentImages:(const std::vector<AttachmentRange> &)ranges { fixtureImageLoads++; }
- (T3MarkdownTextRun *)childForCharacterRange:(NSRange)range {
  for (UIView *child in self.subviews) if ([child isKindOfClass:T3MarkdownTextRun.class]) return (T3MarkdownTextRun *)child;
  return nil;
}
#include "T3MarkdownTextDraw.inc"
@end

static void require(BOOL condition, const char *message) {
  if (!condition) { fprintf(stderr, "%s\n", message); exit(1); }
}

int main() {
  @autoreleasepool {
    NSMutableString *document = [NSMutableString string];
    for (NSUInteger i = 0; i < 10000; i++) [document appendString:@"Native markdown text preserves selection and accessibility.\n"];
    T3MarkdownText *view = [[T3MarkdownText alloc] initWithText:document];
    const auto start = std::chrono::steady_clock::now();
    [view drawRect:view.bounds];
    const double millis = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
    CountingLayoutManager *layout = (CountingLayoutManager *)view->_textView.layoutManager;
    printf("draw: chars=%lu, enumerations=%lu, fragments=%lu, events=%zu, copiedLines=%zu, copiedBytes=%zu, ms=%.3f\n", (unsigned long)document.length, (unsigned long)layout.enumerationCalls, (unsigned long)layout.lineFragments, emittedEvents, copiedLines, copiedBytes, millis);
    require(emittedEvents == 0 && layout.fullDocumentEnumerationCalls == 0 && copiedLines == 0, "unrequested line-layout work ran during drawing");
    require([view->_textView.text isEqualToString:document], "drawing did not apply the native text");
    require([view->_textView.accessibilityLabel isEqualToString:document], "drawing lost the accessibility label");
    require(view->_textView.textContainer.size.width == 320, "drawing did not update the text container width");
    require(view->_contextAccessibilityElements.count == 1, "drawing lost the base text accessibility element");
    require(view->fixtureImageLoads == 1, "drawing did not maintain attachment image loading");

    view->_textView.selectedRange = NSMakeRange(4, 8);
    [view drawRect:view.bounds];
    require(NSEqualRanges(view->_textView.selectedRange, NSMakeRange(4, 8)), "unchanged drawing cleared selection");
    NSMutableAttributedString *changed = [view->_state->data.attributedString mutableCopy];
    [changed appendAttributedString:[[NSAttributedString alloc] initWithString:@"updated"]];
    view->_state->data.attributedString = changed;
    [view drawRect:view.bounds];
    require(NSEqualRanges(view->_textView.selectedRange, NSMakeRange(4, 8)), "text update cleared selection");
    require([view->_textView.text hasSuffix:@"updated"], "text update did not draw");
    require(!view->_suppressSelectionChange, "drawing left selection callbacks suppressed");

    T3MarkdownText *chipView = [[T3MarkdownText alloc] initWithText:@"\ufffc chip text"];
    chipView->_state->data.attachmentRanges.push_back({0, 1, "fixture:chip"});
    T3MarkdownTextRun *run = [T3MarkdownTextRun new];
    run.text = @"\ufffc chip text";
    [chipView addSubview:run];
    [chipView drawRect:chipView.bounds];
    require([chipView->_textView.accessibilityLabel isEqualToString:@"report.md chip text"], "drawing lost the attachment accessibility label");
    require(chipView->_contextAccessibilityElements.count == 2 && run.contextChipInteractive, "drawing lost the interactive attachment accessibility element");
    require(emittedEvents == 0, "drawing emitted an unused line-layout event");
    printf("native drawing, selection, and attachment accessibility passed\n");
  }
  return 0;
}
