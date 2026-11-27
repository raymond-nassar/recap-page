import { escapeLinkText, parseChecklist } from '../../src/js/lib/markdown.js';

export function checklistTitleForRow(row) {
  const title = row.resolvedIssueTitle.trim().replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ');
  const selectedNumber = Object.hasOwn(row, 'metadataIssueNumber')
    ? row.metadataIssueNumber
    : row.issueNumber;
  if (selectedNumber === null) return title;
  const issueNumber = String(selectedNumber).trim();
  const escapedNumber = issueNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`#\\s*${escapedNumber}(?=\\s|$)`, 'i').test(title)
    ? title
    : `${title} #${issueNumber}`;
}

// A Find-only row has no recorded address, so it is written as a plain line carrying only its
// source occurrence. Vendoring restores its provider id from the reviewed mapping; no link is
// constructed here from the id.
export function findOnlyChecklistLine(row) {
  return `- [ ] ${escapeLinkText(checklistTitleForRow(row))} <!-- mrt:source-occurrence=${row.sourcePosition} -->`;
}

// The title the shared parser reads back from the exact authored line. Restoration compares for
// equality against this rather than a prefix: a prefix check accepted "Secret Wars Journal (2015)
// #10" at the occurrence reviewed as #1 and restored the wrong comic's provider id.
export function findOnlyChecklistTitle(row) {
  const parsed = parseChecklist(findOnlyChecklistLine(row), { legacyIdentityKeys: true });
  if (parsed.entries.length !== 0 || parsed.unresolved.length !== 1) {
    throw new Error(`Find-only source occurrence ${row.sourcePosition} does not author as one plain line`);
  }
  return parsed.unresolved[0].title;
}
