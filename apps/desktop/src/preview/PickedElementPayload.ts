/**
 * Strict structural validator for `PickedElementPayload` messages received
 * from the in-page picker preload (`apps/desktop/src/preview/PickPreload.ts`)
 * via `wc.ipc`. Lives in its own electron-free module so the validator is
 * trivially unit-testable.
 *
 * Validation must be tight: downstream `normalizeElementContextSelection`
 * calls `.trim()` on incoming strings, so a malformed payload (preload bug,
 * future schema mismatch, malicious page that intercepts the preload's IPC
 * channel via prototype pollution) would otherwise throw deep in the
 * renderer and the chip silently never appears.
 */
import {
  PICKED_ELEMENT_MAX_COMPONENT_NAME_LENGTH,
  PICKED_ELEMENT_MAX_HTML_LENGTH,
  PICKED_ELEMENT_MAX_SELECTOR_LENGTH,
  PICKED_ELEMENT_MAX_STACK_FRAME_FILE_LENGTH,
  PICKED_ELEMENT_MAX_STACK_FRAME_NAME_LENGTH,
  PICKED_ELEMENT_MAX_STACK_FRAMES,
  PICKED_ELEMENT_MAX_STYLES_LENGTH,
  PICKED_ELEMENT_MAX_TAG_NAME_LENGTH,
  PICKED_ELEMENT_MAX_TIMESTAMP_LENGTH,
  PICKED_ELEMENT_MAX_TITLE_LENGTH,
  PICKED_ELEMENT_MAX_URL_LENGTH,
  PREVIEW_ANNOTATION_MAX_COMMENT_LENGTH,
  PREVIEW_ANNOTATION_MAX_CSS_PROPERTY_LENGTH,
  PREVIEW_ANNOTATION_MAX_CSS_VALUE_LENGTH,
  PREVIEW_ANNOTATION_MAX_ELEMENTS,
  PREVIEW_ANNOTATION_MAX_ID_LENGTH,
  PREVIEW_ANNOTATION_MAX_REGIONS,
  PREVIEW_ANNOTATION_MAX_STROKES,
  PREVIEW_ANNOTATION_MAX_STROKE_POINTS,
  PREVIEW_ANNOTATION_MAX_STYLE_CHANGES,
  PREVIEW_ANNOTATION_MAX_STYLE_PAYLOAD_LENGTH,
  PREVIEW_ANNOTATION_MAX_TOTAL_STROKE_POINTS,
  type PickedElementPayload,
  type PreviewAnnotationPayload,
} from "@t3tools/contracts";

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function isBoundedStringOrNull(value: unknown, maxLength: number): value is string | null {
  return value === null || isBoundedString(value, maxLength);
}

function isFiniteNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isPickedStackFrame(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const frame = value as Record<string, unknown>;
  return (
    isBoundedStringOrNull(frame["functionName"], PICKED_ELEMENT_MAX_STACK_FRAME_NAME_LENGTH) &&
    isBoundedStringOrNull(frame["fileName"], PICKED_ELEMENT_MAX_STACK_FRAME_FILE_LENGTH) &&
    isFiniteNumberOrNull(frame["lineNumber"]) &&
    isFiniteNumberOrNull(frame["columnNumber"])
  );
}

export function isPickedElementPayload(value: unknown): value is PickedElementPayload {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  if (!isBoundedString(c["pageUrl"], PICKED_ELEMENT_MAX_URL_LENGTH)) return false;
  if (!isBoundedString(c["tagName"], PICKED_ELEMENT_MAX_TAG_NAME_LENGTH)) return false;
  if (!isBoundedString(c["htmlPreview"], PICKED_ELEMENT_MAX_HTML_LENGTH)) return false;
  if (!isBoundedString(c["styles"], PICKED_ELEMENT_MAX_STYLES_LENGTH)) return false;
  if (!isBoundedString(c["pickedAt"], PICKED_ELEMENT_MAX_TIMESTAMP_LENGTH)) return false;
  if (!isBoundedStringOrNull(c["pageTitle"], PICKED_ELEMENT_MAX_TITLE_LENGTH)) return false;
  if (!isBoundedStringOrNull(c["selector"], PICKED_ELEMENT_MAX_SELECTOR_LENGTH)) return false;
  if (!isBoundedStringOrNull(c["componentName"], PICKED_ELEMENT_MAX_COMPONENT_NAME_LENGTH))
    return false;
  if (c["source"] !== null && !isPickedStackFrame(c["source"])) return false;
  if (!Array.isArray(c["stack"]) || c["stack"].length > PICKED_ELEMENT_MAX_STACK_FRAMES)
    return false;
  if (!c["stack"].every(isPickedStackFrame)) return false;
  return true;
}

function isRect(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const rect = value as Record<string, unknown>;
  return ["x", "y", "width", "height"].every(
    (key) =>
      typeof rect[key] === "number" &&
      Number.isFinite(rect[key]) &&
      (key === "x" || key === "y" || rect[key] >= 0),
  );
}

function isPoint(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const point = value as Record<string, unknown>;
  return (
    typeof point["x"] === "number" &&
    Number.isFinite(point["x"]) &&
    typeof point["y"] === "number" &&
    Number.isFinite(point["y"])
  );
}

export function isPreviewAnnotationPayload(value: unknown): value is PreviewAnnotationPayload {
  if (typeof value !== "object" || value === null) return false;
  const annotation = value as Record<string, unknown>;
  if (!isBoundedString(annotation["id"], PREVIEW_ANNOTATION_MAX_ID_LENGTH)) return false;
  if (!isBoundedString(annotation["pageUrl"], PICKED_ELEMENT_MAX_URL_LENGTH)) return false;
  if (!isBoundedStringOrNull(annotation["pageTitle"], PICKED_ELEMENT_MAX_TITLE_LENGTH))
    return false;
  if (!isBoundedString(annotation["comment"], PREVIEW_ANNOTATION_MAX_COMMENT_LENGTH)) return false;
  if (!isBoundedString(annotation["createdAt"], PICKED_ELEMENT_MAX_TIMESTAMP_LENGTH)) return false;
  if (annotation["screenshot"] !== null) return false;

  const elements = annotation["elements"];
  if (!Array.isArray(elements) || elements.length > PREVIEW_ANNOTATION_MAX_ELEMENTS) return false;
  if (
    !elements.every((entry) => {
      if (typeof entry !== "object" || entry === null) return false;
      const target = entry as Record<string, unknown>;
      return (
        isBoundedString(target["id"], PREVIEW_ANNOTATION_MAX_ID_LENGTH) &&
        isPickedElementPayload(target["element"]) &&
        isRect(target["rect"])
      );
    })
  ) {
    return false;
  }

  const regions = annotation["regions"];
  if (!Array.isArray(regions) || regions.length > PREVIEW_ANNOTATION_MAX_REGIONS) return false;
  if (
    !regions.every((entry) => {
      if (typeof entry !== "object" || entry === null) return false;
      const target = entry as Record<string, unknown>;
      return (
        isBoundedString(target["id"], PREVIEW_ANNOTATION_MAX_ID_LENGTH) && isRect(target["rect"])
      );
    })
  ) {
    return false;
  }

  const strokes = annotation["strokes"];
  if (!Array.isArray(strokes) || strokes.length > PREVIEW_ANNOTATION_MAX_STROKES) return false;
  let totalStrokePoints = 0;
  if (
    !strokes.every((entry) => {
      if (typeof entry !== "object" || entry === null) return false;
      const target = entry as Record<string, unknown>;
      const points = target["points"];
      if (!Array.isArray(points) || points.length > PREVIEW_ANNOTATION_MAX_STROKE_POINTS) {
        return false;
      }
      totalStrokePoints += points.length;
      return (
        totalStrokePoints <= PREVIEW_ANNOTATION_MAX_TOTAL_STROKE_POINTS &&
        isBoundedString(target["id"], PREVIEW_ANNOTATION_MAX_ID_LENGTH) &&
        isBoundedString(target["color"], PREVIEW_ANNOTATION_MAX_CSS_VALUE_LENGTH) &&
        typeof target["width"] === "number" &&
        Number.isFinite(target["width"]) &&
        target["width"] > 0 &&
        points.every(isPoint) &&
        isRect(target["bounds"])
      );
    })
  ) {
    return false;
  }

  const styleChanges = annotation["styleChanges"];
  if (!Array.isArray(styleChanges) || styleChanges.length > PREVIEW_ANNOTATION_MAX_STYLE_CHANGES)
    return false;
  let totalStylePayloadLength = 0;
  if (
    !styleChanges.every((entry) => {
      if (typeof entry !== "object" || entry === null) return false;
      const change = entry as Record<string, unknown>;
      const targetId = change["targetId"];
      const selector = change["selector"];
      const property = change["property"];
      const previousValue = change["previousValue"];
      const nextValue = change["value"];
      if (
        !isBoundedString(targetId, PREVIEW_ANNOTATION_MAX_ID_LENGTH) ||
        !isBoundedStringOrNull(selector, PICKED_ELEMENT_MAX_SELECTOR_LENGTH) ||
        !isBoundedString(property, PREVIEW_ANNOTATION_MAX_CSS_PROPERTY_LENGTH) ||
        !isBoundedString(previousValue, PREVIEW_ANNOTATION_MAX_CSS_VALUE_LENGTH) ||
        !isBoundedString(nextValue, PREVIEW_ANNOTATION_MAX_CSS_VALUE_LENGTH)
      ) {
        return false;
      }
      totalStylePayloadLength +=
        targetId.length +
        (selector?.length ?? 0) +
        property.length +
        previousValue.length +
        nextValue.length;
      return totalStylePayloadLength <= PREVIEW_ANNOTATION_MAX_STYLE_PAYLOAD_LENGTH;
    })
  ) {
    return false;
  }
  return true;
}
