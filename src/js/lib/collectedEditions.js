import { editionCatalog } from '../../data/collectedEditionCatalog.js';
import { editionEvidence } from '../../data/collectedEditionEvidence.js';
import { acceptedLink } from './editionDestinations.js';

export { editionCatalog, editionEvidence };

// One link per provider per book, and only through the shared gate.
export function providerLinks(edition, catalog = editionCatalog) {
  const seen = new Set();
  return (edition.destinations || []).flatMap((destination) => {
    const link = acceptedLink(catalog.providers, destination);
    if (!link || seen.has(link.provider)) return [];
    seen.add(link.provider);
    return [link];
  });
}

export function editionRelations(catalogId, item, catalog = editionCatalog, evidence = editionEvidence) {
  if (!catalogId || !item) return [];
  const seen = new Set();
  return evidence.relations.flatMap((relation) => {
    if (relation.catalogId !== catalogId || relation.issueId !== item.issueId
      || relation.seriesId !== item.seriesId || relation.number !== String(item.number)
      || relation.status !== 'verified' || relation.portion !== 'full' || relation.conflicts?.length !== 0
      || !relation.source || !relation.checkedAt || seen.has(relation.editionId)) return [];
    const edition = catalog.editions[relation.editionId];
    if (!edition?.title) return [];
    seen.add(relation.editionId);
    return [{ id: relation.editionId, title: edition.title, links: providerLinks(edition, catalog) }];
  });
}

export function editionCoverage(catalogId, items, catalog = editionCatalog, evidence = editionEvidence) {
  const covered = new Set();
  const editions = new Set();
  for (const item of items) {
    const relations = editionRelations(catalogId, item, catalog, evidence);
    if (relations.length) covered.add(item.issueId);
    for (const relation of relations) editions.add(relation.id);
  }
  return { covered: covered.size, total: new Set(items.map((item) => item.issueId)).size, editions: [...editions] };
}
