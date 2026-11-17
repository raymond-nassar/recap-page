import { OWNER_GCD_SUPPLEMENT } from '../../lib/model.js';

// The credit the Grand Comics Database's licence asks for, in the plain wording the owner approved
// on 2026-11-16 (recorded on #1427). It names the source and links it, links the licence, and says
// the data was changed; the per-comic addresses and checked dates sit in the separately licensed
// record file. Kept as parts so the app and the order's Markdown notice say exactly the same thing.
export const GCD_DETAILS_CREDIT = Object.freeze({
  before: 'Some release dates and credits in this list come from the ',
  source: Object.freeze({ text: 'Grand Comics Database', href: 'https://www.comics.org/' }),
  middle: ', rearranged for this app and shared under a ',
  license: Object.freeze({ text: 'Creative Commons license', href: 'https://creativecommons.org/licenses/by-sa/4.0/' }),
  after: '.',
});

export function hasGcdDetails(items) {
  return Array.isArray(items) && items.some((item) => item?.metadataSourceKind === OWNER_GCD_SUPPLEMENT);
}

export function gcdDetailsCredit(el) {
  const link = ({ text, href }) => el('a', { href, target: '_blank', rel: 'noopener noreferrer', text });
  const { before, source, middle, license, after } = GCD_DETAILS_CREDIT;
  return el('p', { class: 'edition-credit' }, [before, link(source), middle, link(license), after]);
}

export function gcdDetailsCreditMarkdown() {
  const { before, source, middle, license, after } = GCD_DETAILS_CREDIT;
  return `${before}[${source.text}](${source.href})${middle}[${license.text}](${license.href})${after}`;
}
