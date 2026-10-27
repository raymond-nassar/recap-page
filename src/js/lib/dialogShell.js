// #830: one dialog shell. A shell dialog holds its actions at its foot, and Preview its head with its only
// Close, while what lies between them scrolls (styles.css, "dialog shell"). Each held edge covers an end
// of the scrolling area, so the dialog pads its scroll by their heights, and a control that takes focus
// is scrolled clear of them rather than under them, as WCAG 2.4.11 asks. The heights come from the edges
// themselves rather than from the stylesheet, because larger text and contents that wrap make them
// taller, and neither can be known in advance.
export const HEAD_HEIGHT = '--dialog-head-height';
export const FOOT_HEIGHT = '--dialog-foot-height';

export function holdDialogEdges(dialog, Observer = globalThis.ResizeObserver) {
  const edges = [[dialog?.querySelector('.dialog-head'), HEAD_HEIGHT], [dialog?.querySelector('.dialog-foot'), FOOT_HEIGHT]]
    .filter(([edge]) => edge);
  if (!edges.length || typeof Observer !== 'function') return null;
  const observer = new Observer(() => {
    for (const [edge, property] of edges) dialog.style.setProperty(property, `${edge.getBoundingClientRect().height}px`);
  });
  for (const [edge] of edges) observer.observe(edge);
  return observer;
}
