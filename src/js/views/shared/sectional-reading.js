import { formatRoute, isPlainNavigation } from '../../lib/route.js';
import { openLinkedGuide, SECTIONAL_GUIDE_COPY } from '../../lib/sectionalGuide.js';

export function sectionalStepRows(el, steps, { className, heading, guideId, onFollow }) {
  return steps.flatMap((step) => {
    const text = SECTIONAL_GUIDE_COPY[step.copy] ?? step.title;
    if (!text) return [];
    if (step.kind === 'return-point' || step.kind === 'guide-link') {
      const position = step.localPosition;
      const href = formatRoute({ view: 'new-to-comics', previewId: step.catalogId, previewPosition: position });
      if (!href) throw new Error('Invalid sectional guide destination');
      const status = el('span', { class: 'rail-hint', role: 'status' });
      let pending = false;
      return [el('li', { class: className }, [
        el('a', {
          href, dataset: { act: 'guide-link', key: `${step.catalogId}:${position ?? ''}`, sectionalOpener: '' },
          onclick: async (event) => {
            if (!isPlainNavigation(event)) return;
            event.preventDefault();
            if (pending) return;
            pending = true;
            const anchor = event.currentTarget;
            anchor.setAttribute('aria-busy', 'true');
            status.textContent = '';
            try {
              const { message } = await openLinkedGuide({
                link: step, currentGuideId: guideId,
                open: (id) => onFollow(id, position, anchor),
              });
              status.textContent = message ?? '';
            } finally {
              pending = false;
              anchor.removeAttribute('aria-busy');
            }
          },
        }, text),
        status,
      ])];
    }
    if (step.kind === 'heading' || step.kind === 'marker') {
      return [el('li', { class: className }, [el(heading, { text })])];
    }
    return [el('li', { class: `${className} rail-hint`, text })];
  });
}
