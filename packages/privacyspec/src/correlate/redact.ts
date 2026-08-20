const decodeSafely = (value: string): string => {
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    return value;
  }
};

export const MAX_NORMALIZED_PATH_LENGTH = 2_048;
export const MAX_NORMALIZED_PATH_INPUT_LENGTH = 8_192;
const TRUNCATED_PATH_SUFFIX = "/:truncated";
const UUID_PATH_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const NUMERIC_PATH_SEGMENT = /^\d+$/u;
const LONG_HEX_PATH_SEGMENT = /^[0-9a-f]{16,}$/iu;

export const redactSensitive = (
  value: string,
  sensitiveValues: readonly string[],
  replacement = ":redacted",
): string => {
  let sanitized = value;
  for (const sensitive of sensitiveValues) {
    sanitized = sanitized.replaceAll(sensitive, replacement);
  }
  return sanitized;
};

export const looksSensitive = (value: string): boolean => {
  const decoded = decodeSafely(value);
  return (
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(decoded) ||
    (/^[+()\d\s.-]+$/u.test(decoded) && decoded.replace(/\D/gu, "").length >= 7)
  );
};

export const sanitizeLabel = (
  value: string,
  sensitiveValues: readonly string[],
  maxLength = 1_024,
): string => {
  const redacted = redactSensitive(value, sensitiveValues);
  if (redacted !== value || looksSensitive(value)) return ":redacted";
  return redacted.slice(0, maxLength);
};

export const normalizePath = (pathname: string, sensitiveValues: readonly string[]): string => {
  if (pathname.length === 0) return "/";

  const contentLimit = MAX_NORMALIZED_PATH_LENGTH - TRUNCATED_PATH_SUFFIX.length;
  const boundedPath = pathname.slice(0, MAX_NORMALIZED_PATH_INPUT_LENGTH);
  const pathWasTruncated = boundedPath.length < pathname.length;
  const redactedPath = redactSensitive(boundedPath, sensitiveValues);
  let normalized = "";
  let segmentStart = 0;
  while (segmentStart <= redactedPath.length) {
    const slash = redactedPath.indexOf("/", segmentStart);
    const segmentEnd = slash < 0 ? redactedPath.length : slash;
    const segmentLength = segmentEnd - segmentStart;
    let segment = "";
    if (segmentLength > 0) {
      const redactedSegment = redactedPath.slice(segmentStart, segmentEnd);
      if (redactedSegment === ":redacted") {
        segment = redactedSegment;
      } else if (UUID_PATH_SEGMENT.test(redactedSegment)) {
        segment = ":uuid";
      } else if (NUMERIC_PATH_SEGMENT.test(redactedSegment)) {
        segment = ":number";
      } else if (LONG_HEX_PATH_SEGMENT.test(redactedSegment)) {
        segment = ":id";
      } else {
        segment =
          redactedSegment.length > 80 || looksSensitive(redactedSegment)
            ? ":value"
            : redactedSegment;
      }
    }

    const piece = `${segment}${slash < 0 ? "" : "/"}`;
    if (normalized.length + piece.length > contentLimit) {
      return `${`${normalized}${piece}`.slice(0, contentLimit)}${TRUNCATED_PATH_SUFFIX}`;
    }
    normalized += piece;
    if (slash < 0) break;
    segmentStart = slash + 1;
  }

  if (pathWasTruncated) {
    const base = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
    return `${base.slice(0, contentLimit)}${TRUNCATED_PATH_SUFFIX}`;
  }
  return normalized || "/";
};
