#import "T3ContextChip.h"

static const NSUInteger T3ContextChipCacheCostLimit = 16 * 1024 * 1024;

static NSCache<NSString *, UIImage *> *T3ContextChipImageCache()
{
  static NSCache<NSString *, UIImage *> *cache;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    cache = [NSCache new];
    cache.countLimit = 256;
    cache.totalCostLimit = T3ContextChipCacheCostLimit;
  });
  return cache;
}

static NSUInteger T3ContextChipImageByteCost(UIImage *image)
{
  CGImageRef pixels = image.CGImage;
  return pixels ? CGImageGetBytesPerRow(pixels) * CGImageGetHeight(pixels) : 0;
}

UIImage *T3ContextChipImage(NSDictionary *payload, CGSize size, UIImage *fileIcon)
{
  if (size.width <= 0 || size.height <= 0) return nil;
  NSCache<NSString *, UIImage *> *cache = T3ContextChipImageCache();
  NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:NSJSONWritingSortedKeys error:nil];
  NSString *key = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  key = [key stringByAppendingString:NSStringFromCGSize(size)];
  if (fileIcon != nil) key = [key stringByAppendingString:@":file-icon"];
  UIImage *cached = [cache objectForKey:key];
  if (cached) return cached;
  UIFont *font = T3ContextChipFont(payload);
  CGFloat em = font.pointSize;
  UIColor *accent = T3ContextChipColor(payload[@"accent"]);
  UIColor *foreground = T3ContextChipBlend(accent, T3ContextChipColor(payload[@"foreground"]), 0.22);
  UIColor *border = T3ContextChipBlend(accent, T3ContextChipColor(payload[@"border"]), 0.34);
  UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:size];
  UIImage *image = [renderer imageWithActions:^(UIGraphicsImageRendererContext *context) {
    UIBezierPath *path = [UIBezierPath bezierPathWithRoundedRect:
        CGRectInset(CGRectMake(0, 0, size.width, size.height), 0.5, 0.5)
        cornerRadius:em * 0.5];
    [[accent colorWithAlphaComponent:0.11] setFill];
    [path fill];
    [border setStroke];
    path.lineWidth = 1;
    [path stroke];
    CGFloat iconSize = em * 1.17;
    UIImage *icon = fileIcon
        ?: T3ContextChipVectorIcon(payload[@"symbol"], iconSize, foreground)
        ?: [[UIImage systemImageNamed:payload[@"symbol"]
        withConfiguration:[UIImageSymbolConfiguration configurationWithPointSize:em weight:UIImageSymbolWeightMedium]]
        imageWithTintColor:foreground renderingMode:UIImageRenderingModeAlwaysOriginal];
    [icon drawInRect:CGRectMake(em * 0.5, (size.height - iconSize) / 2, iconSize, iconSize)];
    NSMutableParagraphStyle *paragraph = [NSMutableParagraphStyle new];
    paragraph.lineBreakMode = NSLineBreakByTruncatingMiddle;
    CGFloat x = em * 2;
    [payload[@"label"] drawInRect:CGRectMake(x, (size.height - font.lineHeight) / 2,
                                           MAX(0, size.width - x - em * 0.5), font.lineHeight)
        withAttributes:@{ NSFontAttributeName: font, NSForegroundColorAttributeName: foreground,
                          NSParagraphStyleAttributeName: paragraph }];
  }];
  const NSUInteger cost = T3ContextChipImageByteCost(image);
  if (cost > 0 && cost <= T3ContextChipCacheCostLimit) [cache setObject:image forKey:key cost:cost];
  return image;
}

@implementation T3ContextChipAttachment {
  NSDictionary *_payload;
  UIImage *_fileIcon;
}

- (instancetype)initWithPayload:(NSDictionary *)payload bounds:(CGRect)bounds fileIcon:(UIImage *)fileIcon
{
  if ((self = [super initWithData:nil ofType:nil])) {
    _payload = [payload copy];
    _fileIcon = fileIcon;
    self.bounds = bounds;
  }
  return self;
}

- (CGRect)attachmentBoundsForTextContainer:(NSTextContainer *)container
                    proposedLineFragment:(CGRect)lineFragment
                           glyphPosition:(CGPoint)position
                          characterIndex:(NSUInteger)index
{
  return self.bounds;
}

- (UIImage *)imageForBounds:(CGRect)bounds textContainer:(NSTextContainer *)container characterIndex:(NSUInteger)index
{
  // TextKit asks only when it draws a chip. Keeping image unset lets the shared
  // cache release bitmaps independently of long, mostly offscreen documents.
  return T3ContextChipImage(_payload, self.bounds.size, _fileIcon);
}

@end
