export function copyCloudFailureMetadata(target, source, { unknown = false } = {}) {
  if (unknown || ['unknown', 'not-sent', 'read-only'].includes(source?.outcome)) {
    target.outcome = unknown ? 'unknown' : source.outcome;
  }
  if (Number.isSafeInteger(source?.retryAfterMs) && source.retryAfterMs >= 0) target.retryAfterMs = source.retryAfterMs;
  if (Number.isSafeInteger(source?.status) && source.status >= 100 && source.status <= 599) target.status = source.status;
  return target;
}
