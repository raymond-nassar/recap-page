const LEGACY_ORDERS = Object.freeze({
  'xmen-claremont': Object.freeze({
    id: 'xmen-claremont',
    file: 'xmen_claremont.json',
    name: 'X-Men Core Reading Order: Silver Age to Claremont',
    source: 'https://www.comicbookherald.com/chris-claremont-era-x-men-reading-order-guide/',
    sourceOrigin: "Based on a reader's outline and Comic Book Herald's guide",
    sourceLicense: null,
  }),
  'xmen-claremont-complete': Object.freeze({
    id: 'xmen-claremont-complete',
    file: 'xmen_claremont_complete.json',
    name: 'X-Men Expanded Reading Order: Silver Age to Claremont',
    source: 'https://www.comicbookherald.com/chris-claremont-era-x-men-reading-order-guide/',
    sourceOrigin: "Based on a reader's outline and Comic Book Herald's guide",
    sourceLicense: null,
  }),
});

export function legacyReadingOrder(id) {
  return Object.hasOwn(LEGACY_ORDERS, id ?? '') ? LEGACY_ORDERS[id] : null;
}
