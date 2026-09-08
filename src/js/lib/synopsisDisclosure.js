import { labelledName } from './accname.js';

export function createSynopsisDisclosure() {
  const revealed = new Set();
  return {
    isRevealed: (issueId) => revealed.has(Number(issueId)),
    reveal: (issueId) => revealed.add(Number(issueId)),
    toggle(issueId) {
      const id = Number(issueId);
      if (revealed.has(id)) revealed.delete(id);
      else revealed.add(id);
    },
    clear: () => revealed.clear(),
  };
}

export function renderSynopsisDescription({ button, description, issue, entry, fallback, disclosure }) {
  const prose = typeof entry === 'string' && entry.trim().length > 0;
  const expanded = prose && disclosure.isRevealed(issue.issueId);
  button.hidden = !prose;
  button.textContent = expanded ? 'Hide description' : 'Reveal description (may contain spoilers)';
  button.setAttribute('aria-expanded', String(expanded));
  button.setAttribute('aria-controls', description.id);
  button.setAttribute('aria-label', labelledName(button.textContent, issue.title));
  description.hidden = prose && !expanded;
  description.textContent = prose ? (expanded ? entry : '') : fallback;
}
