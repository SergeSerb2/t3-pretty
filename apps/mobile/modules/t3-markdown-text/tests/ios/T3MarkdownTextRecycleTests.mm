#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#include <cstdio>
#include <memory>
#import <objc/runtime.h>
#include <string>
#include <vector>

// Compile the production lifecycle methods against real UITextView and
// Foundation. Only the Fabric props/state and base-view lifecycle are adapted.
namespace facebook::react {
struct Props {
  using Shared = std::shared_ptr<const Props>;
  virtual ~Props() = default;
};
enum class T3MarkdownTextEllipsizeMode { Head, Middle, Tail, Clip };
struct T3MarkdownTextProps : Props {
  std::string contextClipboardConfig;
  int numberOfLines = 0;
  bool selectable = false;
  bool allowFontScaling = true;
  T3MarkdownTextEllipsizeMode ellipsizeMode = T3MarkdownTextEllipsizeMode::Tail;
  std::string backgroundColor;
};
} // namespace facebook::react
using namespace facebook::react;
static NSString *RCTNSStringFromString(const std::string &value) {
  return [[NSString alloc] initWithBytes:value.data()
                                  length:value.size()
                                encoding:NSUTF8StringEncoding];
}
static UIColor *RCTUIColorFromSharedColor(const std::string &value) {
  if (value == "blue")
    return UIColor.blueColor;
  if (value == "green")
    return UIColor.greenColor;
  return nil;
}
@interface TestTextView : UITextView
@property(nonatomic, copy) NSDictionary *contextClipboardConfig;
@end
@implementation TestTextView
#include "ProductionCopyMethod.inc"
@end
@interface TestBaseView : UIView {
@public
  Props::Shared _props;
  NSUInteger _recycleCalls;
}
- (void)prepareForRecycle;
- (void)updateProps:(Props::Shared const &)props
           oldProps:(Props::Shared const &)oldProps;
@end
@implementation TestBaseView
- (void)prepareForRecycle {
  _recycleCalls++;
}
- (void)updateProps:(Props::Shared const &)props
           oldProps:(Props::Shared const &)oldProps {
  _props = props;
}
@end
@interface T3MarkdownOutsideTapCoordinator : NSObject
- (void)removeTarget:(id)target;
@end
@implementation T3MarkdownOutsideTapCoordinator
- (void)removeTarget:(id)target {
}
@end
static const void *T3MarkdownOutsideTapCoordinatorKey =
    &T3MarkdownOutsideTapCoordinatorKey;
@interface TestMarkdownView : TestBaseView {
@public
  TestTextView *_textView;
  __weak NSObject *_outsideTapWindow;
  std::shared_ptr<int> _state;
  NSArray *_contextAccessibilityElements;
  BOOL _textLayoutNeedsUpdate;
}
@end
@implementation TestMarkdownView
- (instancetype)init {
  if ((self = [super init])) {
    _props = std::make_shared<const T3MarkdownTextProps>();
    _textView = [[TestTextView alloc] initWithFrame:CGRectMake(0, 0, 320, 100)];
    _textView.editable = NO;
  }
  return self;
}
#include "ProductionLifecycleMethods.inc"
@end

static unsigned failures = 0;
#define CHECK(condition, message)                                              \
  do {                                                                         \
    if (!(condition)) {                                                        \
      std::fprintf(stderr, "FAIL: %s\n", message);                             \
      failures++;                                                              \
    }                                                                          \
  } while (0)
static std::shared_ptr<T3MarkdownTextProps> propsWithContext(NSString *label) {
  NSMutableArray *records = [NSMutableArray new];
  NSString *text = [@"x" stringByPaddingToLength:64000
                                      withString:@"x"
                                 startingAtIndex:0];
  for (NSUInteger index = 0; index < 16; index++) {
    [records addObject:@{
      @"version" : @1,
      @"contextId" :
          [NSString stringWithFormat:@"context-%lu", (unsigned long)index],
      @"kind" : @"terminal",
      @"label" : label,
      @"terminalId" : @"terminal",
      @"terminalLabel" : @"Terminal",
      @"lineStart" : @0,
      @"lineEnd" : @100,
      @"text" : text
    }];
  }
  NSData *fragmentData = [NSJSONSerialization dataWithJSONObject:@{
    @"version" : @1,
    @"source" : @{@"environmentId" : @"native-recycle"},
    @"records" : records
  }
                                                         options:0
                                                           error:nil];
  NSString *fragment = [[NSString alloc] initWithData:fragmentData
                                             encoding:NSUTF8StringEncoding];
  NSData *config = [NSJSONSerialization dataWithJSONObject:@{
    @"fragment" : fragment,
    @"ranges" : @[ @{
      @"start" : @0,
      @"end" : @1,
      @"text" : @"[context](t3-context://v1/terminal/context-0)"
    } ]
  }
                                                   options:0
                                                     error:nil];
  auto props = std::make_shared<T3MarkdownTextProps>();
  props->contextClipboardConfig.assign(static_cast<const char *>(config.bytes),
                                       config.length);
  props->numberOfLines = 7;
  props->selectable = true;
  props->allowFontScaling = false;
  props->ellipsizeMode = T3MarkdownTextEllipsizeMode::Middle;
  props->backgroundColor = "blue";
  return props;
}
static void applyProps(TestMarkdownView *view,
                       const std::shared_ptr<T3MarkdownTextProps> &props) {
  Props::Shared incoming = props;
  Props::Shared previous = view->_props;
  [view updateProps:incoming oldProps:previous];
}
static const T3MarkdownTextProps &viewProps(TestMarkdownView *view) {
  return *std::static_pointer_cast<const T3MarkdownTextProps>(view->_props);
}
static void recyclePoolReleasesPayloads() {
  NSMutableArray<TestMarkdownView *> *pool = [NSMutableArray new];
  std::vector<__weak NSDictionary *> dictionaries;
  std::vector<__weak NSString *> labels;
  std::vector<std::weak_ptr<const Props>> props;
  for (unsigned index = 0; index < 8; index++) {
    @autoreleasepool {
      TestMarkdownView *view = [TestMarkdownView new];
      auto incoming =
          propsWithContext([NSString stringWithFormat:@"Context %u", index]);
      applyProps(view, incoming);
      dictionaries.push_back(view->_textView.contextClipboardConfig);
      props.push_back(incoming);
      view->_state = std::make_shared<int>(1);
      NSString *renderedText = [[NSString
          stringWithFormat:@"Message %u ", index] stringByPaddingToLength:600000
                                                               withString:@"x"
                                                          startingAtIndex:0];
      view->_textView.attributedText =
          [[NSAttributedString alloc] initWithString:renderedText];
      view->_textView.accessibilityLabel = [renderedText mutableCopy];
      labels.push_back(view->_textView.accessibilityLabel);
      view->_contextAccessibilityElements = @[ @"context" ];
      [view prepareForRecycle];
      [pool addObject:view];
    }
  }
  size_t retainedRawBytes = 0;
  unsigned retainedDictionaries = 0;
  size_t retainedLabelCharacters = 0;
  for (NSUInteger index = 0; index < pool.count; index++) {
    TestMarkdownView *view = pool[index];
    const auto &retained = viewProps(view);
    if (!retained.contextClipboardConfig.empty())
      retainedRawBytes += retained.contextClipboardConfig.size();
    if (dictionaries[index] != nil)
      retainedDictionaries++;
    retainedLabelCharacters += view->_textView.accessibilityLabel.length;
    CHECK(labels[index] == nil && view->_textView.accessibilityLabel == nil,
          "recycled text views release their explicit full-text accessibility "
          "label");
    CHECK(props[index].expired(),
          "recycled views release the old shared props");
    CHECK(retained.contextClipboardConfig.empty() &&
              retained.contextClipboardConfig.capacity() < 64,
          "recycled props release the JSON string and its buffer capacity");
    CHECK(view->_textView.contextClipboardConfig == nil,
          "recycled native text releases its parsed clipboard dictionary");
    CHECK(!view->_state && view->_textView.attributedText.length == 0 &&
              view->_contextAccessibilityElements == nil,
          "existing state, text and accessibility cleanup remains intact");
    CHECK(CGRectEqualToRect(view->_textView.frame, CGRectZero) &&
              view->_textLayoutNeedsUpdate && view->_recycleCalls == 1,
          "frame reset and superclass recycling remain intact");
    CHECK(retained.numberOfLines == 7 && retained.selectable &&
              !retained.allowFontScaling &&
              retained.ellipsizeMode == T3MarkdownTextEllipsizeMode::Middle &&
              retained.backgroundColor == "blue",
          "previous styles and selection props remain the baseline for reuse");
  }
  std::printf("pooledViews=%lu retainedRawBytes=%zu retainedDictionaries=%u "
              "retainedLabelCharacters=%zu\n",
              (unsigned long)pool.count, retainedRawBytes, retainedDictionaries,
              retainedLabelCharacters);
}
static void reuseReinstallsSameAndDifferentContext() {
  TestMarkdownView *view = [TestMarkdownView new];
  auto first = propsWithContext(@"First");
  applyProps(view, first);
  NSString *original = view->_textView.contextClipboardConfig[@"fragment"];
  [view prepareForRecycle];
  CHECK(first->contextClipboardConfig.size() > 1000000,
        "cleanup never mutates shared shadow props");
  CHECK(view->_textView.contextClipboardConfig == nil,
        "native clipboard is empty while the view is pooled");
  applyProps(view, first);
  CHECK([view->_textView.contextClipboardConfig[@"fragment"]
            isEqualToString:original],
        "reuse with the same config reinstalls the clipboard after the old "
        "baseline is cleared");
  [view prepareForRecycle];
  auto second = propsWithContext(@"Second");
  second->numberOfLines = 3;
  second->selectable = false;
  second->allowFontScaling = true;
  second->ellipsizeMode = T3MarkdownTextEllipsizeMode::Head;
  second->backgroundColor = "green";
  applyProps(view, second);
  CHECK(![view->_textView.contextClipboardConfig[@"fragment"]
            isEqualToString:original],
        "reuse installs a different current context");
  CHECK(view->_textView.textContainer.maximumNumberOfLines == 3 &&
            !view->_textView.selectable &&
            view->_textView.adjustsFontForContentSizeCategory &&
            view->_textView.textContainer.lineBreakMode ==
                NSLineBreakByTruncatingHead &&
            [view->_textView.backgroundColor isEqual:UIColor.greenColor],
        "style changes still apply relative to the retained previous props");
  [view prepareForRecycle];
  auto empty = std::make_shared<T3MarkdownTextProps>();
  applyProps(view, empty);
  CHECK(view->_textView.contextClipboardConfig == nil &&
            viewProps(view).contextClipboardConfig.empty(),
        "reuse without context leaves no stale clipboard payload");
  CHECK(view->_textView.textContainer.maximumNumberOfLines == 0 &&
            !view->_textView.selectable &&
            view->_textView.adjustsFontForContentSizeCategory &&
            view->_textView.textContainer.lineBreakMode ==
                NSLineBreakByTruncatingTail,
        "default styles correctly replace a recycled styled view");
  [view prepareForRecycle];
  CHECK(view->_recycleCalls == 4, "repeated recycling remains valid");
}
@interface TestPasteboard : NSObject
@property(nonatomic, copy) NSArray<NSDictionary *> *items;
@end
@implementation TestPasteboard
@end
static TestPasteboard *testPasteboard;
static id replacementPasteboard(id receiver, SEL selector) {
  return testPasteboard;
}
static void nativeCopyUsesCurrentReusedContext() {
  // Replace the getter in this test process, so no test touches the user's
  // clipboard.
  Method getter =
      class_getClassMethod(UIPasteboard.class, @selector(generalPasteboard));
  IMP original = method_setImplementation(
      getter, reinterpret_cast<IMP>(replacementPasteboard));
  testPasteboard = [TestPasteboard new];
  @try {
    TestMarkdownView *view = [TestMarkdownView new];
    auto props = propsWithContext(@"Current context");
    applyProps(view, props);
    [view prepareForRecycle];
    applyProps(view, props);
    view->_textView.text = @"\u200B";
    view->_textView.selectedRange = NSMakeRange(0, 1);
    [view->_textView copy:nil];
    NSDictionary *item = testPasteboard.items.firstObject;
    CHECK([item[@"public.utf8-plain-text"]
              isEqualToString:@"[context](t3-context://v1/terminal/context-0)"],
          "copy restores the canonical reference after same-context reuse");
    NSDictionary *copied =
        [NSJSONSerialization JSONObjectWithData:item[@"app.t3.context-fragment"]
                                        options:0
                                          error:nil];
    NSArray *records = copied[@"records"];
    CHECK(
        records.count == 1 &&
            [records.firstObject[@"contextId"] isEqualToString:@"context-0"] &&
            [records.firstObject[@"text"] length] == 64000,
        "copy includes only the current selected context payload");
    CHECK(item[@"public.html"] != nil,
          "copy preserves the portable HTML context flavor");
    NSArray *ranges = view->_textView.contextClipboardConfig[@"ranges"];
    for (NSString *fragment in
         @[ @"{invalid", @"", @"{\"version\":1,\"records\":[]}" ]) {
      auto next = std::make_shared<T3MarkdownTextProps>(*props);
      NSData *config = [NSJSONSerialization
          dataWithJSONObject:@{@"fragment" : fragment, @"ranges" : ranges}
                     options:0
                       error:nil];
      next->contextClipboardConfig.assign(
          static_cast<const char *>(config.bytes), config.length);
      applyProps(view, next);
      [view->_textView copy:nil];
      NSDictionary *plain = testPasteboard.items.firstObject;
      CHECK([plain[@"public.utf8-plain-text"]
                isEqualToString:
                    @"[context](t3-context://v1/terminal/context-0)"] &&
                plain[@"app.t3.context-fragment"] == nil,
            "invalid, empty or pruned context copies plain references without "
            "old metadata");
    }
  } @finally {
    method_setImplementation(getter, original);
    testPasteboard = nil;
  }
}
int main() {
  @autoreleasepool {
    recyclePoolReleasesPayloads();
    reuseReinstallsSameAndDifferentContext();
    nativeCopyUsesCurrentReusedContext();
    std::printf("native lifecycle cases=3 failures=%u\n", failures);
  }
  return failures == 0 ? 0 : 1;
}
