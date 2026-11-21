const sharedExpandedPlaceholders = new Map([
  ['xmen-silver-age', new Set(['X-Men Annual (1970) #2'])],
  ['xmen-claremont-era', new Set(['Power Pack (1984) #27', 'Power Pack (1984) #28'])],
]);

export function placeholderId(orderId, title, sourceKey = null) {
  // These entries keep the Expanded guide's established comic records.
  const identityOrder = sourceKey == null && sharedExpandedPlaceholders.get(orderId)?.has(title)
    ? 'xmen-claremont-complete' : orderId;
  let h = 0x811c9dc5;
  for (const ch of `${identityOrder}:${sourceKey ?? title}`) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return -((h % 0x7ffffffe) + 1);
}
