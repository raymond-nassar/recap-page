export function placeholderId(orderId, title, sourceKey = null) {
  let h = 0x811c9dc5;
  for (const ch of `${orderId}:${sourceKey ?? title}`) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return -((h % 0x7ffffffe) + 1);
}
