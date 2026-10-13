#import <UIKit/UIKit.h>
#import <objc/runtime.h>
#include <chrono>
#include <cstdio>
#include <memory>
#include <string>
#include <unordered_set>
#include <vector>

// Compile the production image/attachment implementation and both construction
// paths. Only React transport types and the containing view are adapted here.
#include "ProductionChipFeatures.inc"
#include "ProductionChipImplementation.inc"
using Float = float;
#include "ProductionAttachmentTypes.inc"
#include "ProductionDrawAttachments.inc"
#include "ProductionShadowAttachments.inc"

static unsigned failures;
#define CHECK(condition, message) do { if (!(condition)) { std::fprintf(stderr, "%s\n", message); failures++; } } while (false)
static NSUInteger bitmapRequests;
static BOOL countBitmaps;
using RendererMethod = UIImage *(*)(id, SEL, void (^)(UIGraphicsImageRendererContext *));
static RendererMethod originalRender;
static UIImage *countRender(id receiver, SEL selector, void (^actions)(UIGraphicsImageRendererContext *)) {
  if (countBitmaps) bitmapRequests++;
  return originalRender(receiver, selector, actions);
}

static NSDictionary *payload(NSUInteger index, double scale = 1) {
  return @{@"label": [NSString stringWithFormat:@"component-%lu.tsx", (unsigned long)index],
           @"fontSize": @11.2, @"fontSizeMultiplier": @(scale), @"accent": @"#009f6e",
           @"foreground": @"#101010", @"border": @"#909090", @"symbol": @"doc",
           @"interactive": @YES};
}
static std::string uri(NSDictionary *value) {
  NSData *json = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys error:nil];
  NSString *text = [@"chip:" stringByAppendingString:[[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding]];
  return text.UTF8String;
}
static NSDictionary *attributes() {
  NSMutableParagraphStyle *paragraph = [NSMutableParagraphStyle new];
  paragraph.minimumLineHeight = 18;
  return @{NSFontAttributeName: [UIFont systemFontOfSize:14], NSParagraphStyleAttributeName: paragraph,
           NSForegroundColorAttributeName: UIColor.redColor, NSBaselineOffsetAttributeName: @1};
}
static NSMutableAttributedString *document(NSUInteger count, double scale,
                                           std::vector<T3MarkdownTextAttachmentRange> &ranges) {
  NSMutableAttributedString *text = [NSMutableAttributedString new];
  for (NSUInteger i = 0; i < count; i++) {
    NSDictionary *chip = payload(i, scale);
    CGSize size = T3ContextChipSize(chip, 320);
    ranges.push_back({text.length, 1, uri(chip), false, (Float)size.width, (Float)size.height});
    [text appendAttributedString:[[NSAttributedString alloc] initWithString:@"\uFFFC\n" attributes:attributes()]];
  }
  return text;
}
static NSTextAttachment *attachmentAt(NSAttributedString *document, NSUInteger index) {
  return [document attribute:NSAttachmentAttributeName atIndex:index effectiveRange:nil];
}
static NSData *pixels(UIImage *image) {
  return CFBridgingRelease(CGDataProviderCopyData(CGImageGetDataProvider(image.CGImage)));
}
struct TextLayout {
  NSTextStorage *__strong storage;
  NSLayoutManager *__strong manager;
  NSTextContainer *__strong container;
};
static TextLayout layout(NSAttributedString *document) {
  NSTextStorage *storage = [[NSTextStorage alloc] initWithAttributedString:document];
  NSLayoutManager *manager = [NSLayoutManager new];
  manager.usesFontLeading = NO;
  NSTextContainer *container = [[NSTextContainer alloc] initWithSize:CGSizeMake(320, 100000)];
  container.lineFragmentPadding = 0;
  [manager addTextContainer:container];
  [storage addLayoutManager:manager];
  [manager ensureLayoutForTextContainer:container];
  return {storage, manager, container};
}
static void workload(double scale) {
  @autoreleasepool {
#if T3_LAZY_CONTEXT_CHIPS
    [T3ContextChipImageCache() removeAllObjects];
#endif
    std::vector<T3MarkdownTextAttachmentRange> ranges;
    NSMutableAttributedString *text = document(1000, scale, ranges);
    bitmapRequests = 0;
    countBitmaps = YES;
    auto start = std::chrono::steady_clock::now();
    T3MarkdownTextApplyAttachments(text, ranges, @{});
    const double prepare = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
    const NSUInteger prepared = bitmapRequests;
    TextLayout textLayout = layout(text);
    NSLayoutManager *manager = textLayout.manager;
    const NSUInteger duringLayout = bitmapRequests - prepared;
    countBitmaps = NO;
    NSRange visible = [manager glyphRangeForBoundingRect:CGRectMake(0, 0, 320, 200)
                                        inTextContainer:manager.textContainers.firstObject];
    UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:CGSizeMake(320, 200)];
    const NSUInteger beforeDraw = bitmapRequests;
    [renderer imageWithActions:^(UIGraphicsImageRendererContext *context) {
      countBitmaps = YES;
      [manager drawGlyphsForGlyphRange:visible atPoint:CGPointZero];
      countBitmaps = NO;
    }];
    NSUInteger owned = 0, visibleChips = 0;
    size_t ownedBytes = 0;
    std::unordered_set<CGImageRef> unique;
    for (const auto &range : ranges) {
      UIImage *image = attachmentAt(text, range.location).image;
      if (image.CGImage) {
        owned++;
        if (unique.insert(image.CGImage).second)
          ownedBytes += CGImageGetBytesPerRow(image.CGImage) * CGImageGetHeight(image.CGImage);
      }
      if (NSLocationInRange(range.location, visible)) visibleChips++;
    }
    const NSUInteger drawn = bitmapRequests - beforeDraw;
    std::printf("chips scale=%.2f count=1000 prepareImages=%lu layoutImages=%lu drawImages=%lu visibleChips=%lu ownedImages=%lu ownedPixelBytes=%zu prepareMs=%.2f\n",
                scale, (unsigned long)prepared, (unsigned long)duringLayout, (unsigned long)drawn,
                (unsigned long)visibleChips, (unsigned long)owned, ownedBytes, prepare);
    CHECK(prepared == 0 && duringLayout == 0, "offscreen preparation and TextKit layout create no chip bitmaps");
    CHECK(drawn == visibleChips && drawn > 0 && drawn < 1000, "TextKit draws only visible chip images");
    CHECK(owned == 0 && ownedBytes == 0, "attributed attachments do not own rendered chip bitmaps");
  }
}
static void appearanceAndMeasurement() {
  for (NSNumber *scale in @[@1, @3.12]) {
    std::vector<T3MarkdownTextAttachmentRange> ranges;
    NSMutableAttributedString *text = document(1, scale.doubleValue, ranges);
    NSMutableAttributedString *measurement = [text mutableCopy];
    T3MarkdownTextApplyAttachments(text, ranges, @{});
    applyAttachments(measurement, ranges);
    NSTextAttachment *chip = attachmentAt(text, 0);
    NSDictionary *value = payload(0, scale.doubleValue);
    CGSize size = T3ContextChipSize(value, 320);
    UIImage *eager = T3ContextChipImage(value, size, nil);
    UIImage *lazy = [chip imageForBounds:chip.bounds textContainer:nil characterIndex:0];
    CHECK([pixels(eager) isEqualToData:pixels(lazy)], "lazy drawing preserves exact chip pixels, text and colors");
    CHECK(CGRectEqualToRect(chip.bounds, T3ContextChipBounds(attributes()[NSFontAttributeName], size)),
          "chip dimensions and baseline match the existing eager renderer at every font scale");
    CHECK(CGRectEqualToRect(chip.bounds, attachmentAt(measurement, 0).bounds), "shadow measurement and native drawing use identical bounds");
    CHECK(CGRectEqualToRect([chip attachmentBoundsForTextContainer:nil proposedLineFragment:CGRectZero glyphPosition:CGPointZero characterIndex:0], chip.bounds),
          "TextKit uses explicit attachment bounds without reading an image");
    TextLayout drawingLayout = layout(text);
    TextLayout measurementLayout = layout(measurement);
    CHECK(CGRectEqualToRect([drawingLayout.manager usedRectForTextContainer:drawingLayout.container],
                           [measurementLayout.manager usedRectForTextContainer:measurementLayout.container]),
          "shadow and drawing preserve full TextKit layout dimensions");
    for (NSAttributedStringKey key in attributes())
      CHECK([[text attribute:key atIndex:0 effectiveRange:nil] isEqual:attributes()[key]], "chip substitution preserves run attributes");
  }
  NSDictionary *chip = payload(17);
  UIImage *icon = [UIImage systemImageNamed:@"star.fill"];
  NSMutableDictionary *withIcon = [chip mutableCopy];
  withIcon[@"iconUri"] = @"fixture:file-icon";
  std::vector<T3MarkdownTextAttachmentRange> ranges;
  NSMutableAttributedString *text = document(1, 1, ranges);
  ranges[0].imageUri = uri(withIcon);
  T3MarkdownTextApplyAttachments(text, ranges, @{@"fixture:file-icon": icon});
  NSTextAttachment *attachment = attachmentAt(text, 0);
  UIImage *expected = T3ContextChipImage(withIcon, attachment.bounds.size, icon);
  CHECK([pixels(expected) isEqualToData:pixels([attachment imageForBounds:attachment.bounds textContainer:nil characterIndex:0])],
        "loaded file icons use the same pixels in lazy chip drawing");
  NSMutableDictionary *dark = [chip mutableCopy];
  dark[@"foreground"] = @"#eeeeee";
  dark[@"border"] = @"#404040";
  CGSize size = T3ContextChipSize(chip, 320);
  CHECK(![pixels(T3ContextChipImage(chip, size, nil)) isEqualToData:pixels(T3ContextChipImage(dark, size, nil))],
        "theme changes keep distinct cached colors");
  dark[@"symbol"] = @"git-pull-request";
  ranges[0].imageUri = uri(dark);
  T3MarkdownTextApplyAttachments(text, ranges, @{});
  attachment = attachmentAt(text, 0);
  CHECK([pixels(T3ContextChipImage(dark, attachment.bounds.size, nil))
      isEqualToData:pixels([attachment imageForBounds:attachment.bounds textContainer:nil characterIndex:0])],
        "vector icons preserve their exact existing pixels");
}
static void cacheReleasesBitmaps() {
#if T3_LAZY_CONTEXT_CHIPS
  NSCache *cache = T3ContextChipImageCache();
  CHECK(cache.countLimit == 256 && cache.totalCostLimit == 16 * 1024 * 1024,
        "one shared image cache preserves its entry limit and has a 16 MiB pixel cost limit");
  [cache removeAllObjects];
  __weak UIImage *weakImage;
  T3ContextChipAttachment *attachment;
  @autoreleasepool {
    NSDictionary *value = payload(4242);
    CGSize size = T3ContextChipSize(value, 320);
    attachment = [[T3ContextChipAttachment alloc] initWithPayload:value bounds:(CGRect){CGPointZero, size} fileIcon:nil];
    UIImage *image = [attachment imageForBounds:attachment.bounds textContainer:nil characterIndex:0];
    weakImage = image;
    CHECK(image == [attachment imageForBounds:attachment.bounds textContainer:nil characterIndex:0], "visible repeated draws reuse cached pixels");
    [cache removeAllObjects];
  }
  CHECK(weakImage == nil && attachment.image == nil, "cache eviction releases pixels while the document attachment remains mounted");
  UIImage *redrawn = [attachment imageForBounds:attachment.bounds textContainer:nil characterIndex:0];
  CHECK(redrawn.CGImage != nil, "a later visible draw recreates an evicted chip image");
  [cache removeAllObjects];
  NSHashTable<UIImage *> *weakImages = [NSHashTable weakObjectsHashTable];
  size_t requestedBytes = 0;
  for (NSUInteger i = 0; i < 100; i++) {
    @autoreleasepool {
      NSDictionary *value = payload(10000 + i, 3.12);
      UIImage *image = T3ContextChipImage(value, T3ContextChipSize(value, 320), nil);
      requestedBytes += T3ContextChipImageByteCost(image);
      [weakImages addObject:image];
    }
  }
  size_t cachedBytes = 0;
  NSArray<UIImage *> *liveImages = weakImages.allObjects;
  for (UIImage *image in liveImages) cachedBytes += T3ContextChipImageByteCost(image);
  std::printf("chip cache requestedImages=100 retainedImages=%lu requestedPixelBytes=%zu retainedPixelBytes=%zu costLimit=%lu\n",
              (unsigned long)liveImages.count, requestedBytes, cachedBytes, (unsigned long)cache.totalCostLimit);
  // NSCache's cost limit is advisory. Check observable eviction, not a strict
  // allocation/RSS bound that the platform does not promise.
  CHECK(liveImages.count < 100 && cachedBytes < requestedBytes,
        "the real pixel cost limit evicts large images before the 256-entry limit");
  __weak UIImage *oversized;
  @autoreleasepool {
    UIImage *image = T3ContextChipImage(payload(8484), CGSizeMake(2200, 2200), nil);
    CHECK(T3ContextChipImageByteCost(image) > cache.totalCostLimit, "oversized fixture exceeds the real pixel cost limit");
    oversized = image;
  }
  CHECK(oversized == nil, "an oversized image is returned for drawing but is never retained by the shared cache");
  CHECK(T3ContextChipImage(payload(1), CGSizeZero, nil) == nil, "empty chip bounds do not allocate a bitmap");
#endif
}
static void regularAttachments() {
  NSMutableAttributedString *text = [[NSMutableAttributedString alloc] initWithString:@"ab" attributes:attributes()];
  std::vector<T3MarkdownTextAttachmentRange> ranges = {{0, 1, "sf:star.fill", true}, {1, 1, "fixture:image", false}};
  UIImage *image = [UIImage systemImageNamed:@"doc"];
  T3MarkdownTextApplyAttachments(text, ranges, @{@"fixture:image": image});
  CHECK(attachmentAt(text, 0).image.CGImage != nil && attachmentAt(text, 1).image == image,
        "ordinary symbol and file attachments still own their existing images");
  CHECK(CGRectEqualToRect(attachmentAt(text, 0).bounds, CGRectMake(0, -2, 14, 14)), "ordinary attachment dimensions stay unchanged");
}

@interface TestPasteboard : NSObject
@property(nonatomic, copy) NSArray<NSDictionary *> *items;
@end
@implementation TestPasteboard
@end
static TestPasteboard *testPasteboard;
static id replacementPasteboard(id receiver, SEL selector) { return testPasteboard; }
@interface ChipCopyTextView : UITextView
@property(nonatomic, copy) NSDictionary *contextClipboardConfig;
@end
@implementation ChipCopyTextView
#include "ProductionCopyMethod.inc"
@end
struct FixtureData { std::vector<T3MarkdownTextAttachmentRange> attachmentRanges; };
struct FixtureState { FixtureData data; const FixtureData &getData() const { return data; } };
static void copyAndAccessibility() {
  std::vector<T3MarkdownTextAttachmentRange> ranges;
  NSMutableAttributedString *convertedAttrString = document(1, 1, ranges);
  T3MarkdownTextApplyAttachments(convertedAttrString, ranges, @{});
  auto _state = std::make_shared<FixtureState>();
  _state->data.attachmentRanges = ranges;
  ChipCopyTextView *_textView = [ChipCopyTextView new];
  _textView.attributedText = convertedAttrString;
#include "ProductionAccessibilityLabel.inc"
  CHECK([_textView.accessibilityLabel isEqualToString:@"component-0.tsx\n"], "the production accessibility path still exposes the chip label");
  NSDictionary *record = @{@"contextId": @"context-0", @"text": @"selected payload"};
  NSData *fragment = [NSJSONSerialization dataWithJSONObject:@{@"version": @1, @"records": @[record]} options:0 error:nil];
  _textView.contextClipboardConfig = @{@"fragment": [[NSString alloc] initWithData:fragment encoding:NSUTF8StringEncoding],
    @"ranges": @[@{@"start": @0, @"end": @1, @"text": @"[component-0.tsx](t3-context://v1/file/context-0)"}]};
  _textView.selectedRange = NSMakeRange(0, 1);
  Method getter = class_getClassMethod(UIPasteboard.class, @selector(generalPasteboard));
  IMP original = method_setImplementation(getter, reinterpret_cast<IMP>(replacementPasteboard));
  testPasteboard = [TestPasteboard new];
  @try {
    [_textView copy:nil];
    NSDictionary *item = testPasteboard.items.firstObject;
    CHECK([item[@"public.utf8-plain-text"] isEqualToString:@"[component-0.tsx](t3-context://v1/file/context-0)"],
          "selecting a lazy chip copies the canonical reference without needing its bitmap");
    NSDictionary *copied = [NSJSONSerialization JSONObjectWithData:item[@"app.t3.context-fragment"] options:0 error:nil];
    CHECK([copied[@"records"] isEqual:@[record]] && item[@"public.html"] != nil, "native copy preserves selected payload and portable HTML");
    CHECK(NSEqualRanges(_textView.selectedRange, NSMakeRange(0, 1)), "copy preserves the native selection");
  } @finally {
    method_setImplementation(getter, original);
    testPasteboard = nil;
  }
}
int main() {
  @autoreleasepool {
    Method method = class_getInstanceMethod(UIGraphicsImageRenderer.class, @selector(imageWithActions:));
    originalRender = reinterpret_cast<RendererMethod>(method_setImplementation(method, reinterpret_cast<IMP>(countRender)));
    workload(1);
    workload(3.12);
    appearanceAndMeasurement();
    cacheReleasesBitmaps();
    regularAttachments();
    copyAndAccessibility();
    method_setImplementation(method, reinterpret_cast<IMP>(originalRender));
    std::printf("native chip cases=6 failures=%u\n", failures);
  }
  return failures == 0 ? 0 : 1;
}
