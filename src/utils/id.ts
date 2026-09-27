let counter = 0;

/** Unique id for request correlation. Uses crypto when available. */
export function createRequestId(prefix = 'req'): string {
  counter += 1;
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${counter.toString(36)}-${random}`;
}
