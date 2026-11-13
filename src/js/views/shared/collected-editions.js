import { editionEvidence, editionRelations } from '../../lib/collectedEditions.js';

export function collectedEditionLabels(el, catalogId, item, catalog, evidence) {
  const relations = editionRelations(catalogId, item, catalog, evidence);
  if (!relations.length) return null;
  return el('div', { class: 'collected-editions' }, relations.map((edition) => el('div', {
    class: 'collected-edition',
  }, [
    el('span', { text: `Collected in ${edition.title}` }),
    ...edition.links.map((link) => el('a', {
      href: link.url, target: '_blank', rel: 'noopener noreferrer', referrerPolicy: 'no-referrer',
      'aria-label': `Look for ${edition.title} ${link.preposition} ${link.name} (opens outside Recap Page)`,
      text: `Look for this book ${link.preposition} ${link.name}`,
    })),
  ])));
}

export function collectedEditionCredit(el) {
  return el('p', { class: 'edition-credit' }, [
    'Contents relations adapted from ',
    el('a', { href: 'https://www.comics.org/', target: '_blank', rel: 'noopener noreferrer', text: 'Grand Comics Database' }),
    ' under ',
    el('a', { href: editionEvidence.licenseUrl, target: '_blank', rel: 'noopener noreferrer', text: editionEvidence.license }),
    '. Curated book names. Links say where to look for a book, not that it can be borrowed there.',
  ]);
}
