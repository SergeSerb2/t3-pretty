export const DIAGNOSTIC_TEXT_LIMIT = 16_384;
export const DIAGNOSTIC_URL_LIMIT = 4_096;
export const DIAGNOSTIC_LABEL_LIMIT = 128;
const DIAGNOSTIC_TRUNCATION_SUFFIX = " [truncated]";

// Even a short input can be a substring backed by a much larger protocol message.
const copyDiagnosticPrefix = (text: string, length: number): string =>
  Buffer.from(text.slice(0, length), "utf16le").toString("utf16le");

export const boundDiagnosticText = (value: unknown, maxLength = DIAGNOSTIC_TEXT_LIMIT): string => {
  const text = String(value);
  if (text.length <= maxLength) return copyDiagnosticPrefix(text, text.length);
  const prefix = copyDiagnosticPrefix(text, maxLength - DIAGNOSTIC_TRUNCATION_SUFFIX.length);
  return `${prefix}${DIAGNOSTIC_TRUNCATION_SUFFIX}`;
};

export const diagnosticConsoleText = (args: ReadonlyArray<unknown>): string => {
  let text = "";
  for (const [index, arg] of args.entries()) {
    if (index !== 0 && text.length === DIAGNOSTIC_TEXT_LIMIT) {
      return `${copyDiagnosticPrefix(text, DIAGNOSTIC_TEXT_LIMIT - DIAGNOSTIC_TRUNCATION_SUFFIX.length)}${DIAGNOSTIC_TRUNCATION_SUFFIX}`;
    }
    const value =
      typeof arg === "object" && arg !== null
        ? String(Reflect.get(arg, "value") ?? Reflect.get(arg, "description") ?? "")
        : String(arg);
    const separator = index === 0 ? "" : " ";
    if (text.length + separator.length + value.length > DIAGNOSTIC_TEXT_LIMIT) {
      const prefixLimit = DIAGNOSTIC_TEXT_LIMIT - DIAGNOSTIC_TRUNCATION_SUFFIX.length;
      const remaining = prefixLimit - text.length - separator.length;
      if (remaining < 0)
        return `${copyDiagnosticPrefix(text, prefixLimit)}${DIAGNOSTIC_TRUNCATION_SUFFIX}`;
      const prefix = copyDiagnosticPrefix(value, remaining);
      return `${copyDiagnosticPrefix(text, text.length)}${separator}${prefix}${DIAGNOSTIC_TRUNCATION_SUFFIX}`;
    }
    text = `${text}${separator}${value}`;
  }
  return copyDiagnosticPrefix(text, text.length);
};
