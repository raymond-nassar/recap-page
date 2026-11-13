// Where a collected edition may link, shared by the app and the generator so a destination the
// build accepts is exactly one the app will show. Each provider has one accepted address shape.
// Hoopla's comes from its own title pages; Libby's is the share link Libby Help documents, which
// opens the title in the reader's own library rather than naming one.
const DESTINATION_RULES = Object.freeze({
  hoopla: Object.freeze({ host: 'www.hoopladigital.com', path: /^\/(?:comic\/[a-z0-9-]+\/|title\/)\d+$/, preposition: 'on' }),
  libby: Object.freeze({ host: 'share.libbyapp.com', path: /^\/title\/\d+$/, preposition: 'in' }),
});

export const DESTINATION_PROVIDERS = Object.freeze(Object.keys(DESTINATION_RULES));

// Links rest on the owner's recorded approval on Issue #1203, not on a permission from a provider,
// so a basis must name the exact comment that holds it.
export const LINK_BASES = Object.freeze(['owner-approval']);
const BASIS_EVIDENCE = /^https:\/\/github\.com\/raymond-nassar\/recap-page\/issues\/\d+#issuecomment-\d+$/;

export const isCheckedDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

export function destinationUrl(provider, value) {
  const rule = Object.hasOwn(DESTINATION_RULES, provider) ? DESTINATION_RULES[provider] : null;
  if (!rule || typeof value !== 'string') return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== rule.host || url.port || url.username || url.password
    || url.search || url.hash || !rule.path.test(url.pathname) || url.href !== value) return null;
  return url.href;
}

export function providerAccepted(provider) {
  return Boolean(provider?.name) && LINK_BASES.includes(provider.basis) && BASIS_EVIDENCE.test(provider.basisEvidence || '');
}

// A link needs a recorded basis for its provider and a destination the owner confirmed on a
// checked date. Anything else is dropped, never repaired.
export function acceptedLink(providers, destination) {
  const key = destination?.provider;
  const provider = providers && Object.hasOwn(providers, key) ? providers[key] : null;
  const url = destinationUrl(key, destination?.url);
  if (!url || !providerAccepted(provider) || destination.confirmedBy !== 'owner'
    || !isCheckedDate(destination.checkedAt)) return null;
  return { provider: key, name: provider.name, preposition: DESTINATION_RULES[key].preposition, url };
}
