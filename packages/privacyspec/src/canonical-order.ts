/**
 * Compares strings by their UTF-16 code units.
 *
 * This is the canonical persisted-artifact order. It is deliberately independent of the host
 * locale and must be shared by both artifact producers and strict validators.
 */
export const compareCanonicalStrings = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};
