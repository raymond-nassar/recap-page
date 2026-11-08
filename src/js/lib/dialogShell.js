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
  const head = dialog.querySelector('.preview-head');
  const title = head?.querySelector('h2');
  const close = head?.querySelector('#preview-close');
  const foot = dialog.querySelector('.dialog-foot');
  const add = dialog.querySelector('#preview-add');
  const secondary = dialog.querySelector('#preview-secondary');
  const offline = dialog.querySelector('#preview-offline');
  let budgetInputs = null;
  const observer = new Observer(() => {
    if (title && close && dialog.clientHeight > 0) {
      const inputs = JSON.stringify([
        dialog.clientWidth, dialog.clientHeight,
        typeof globalThis.getComputedStyle === 'function' ? globalThis.getComputedStyle(title).fontSize : '',
        title.textContent, add?.querySelector('[data-act="main"]')?.textContent,
        secondary?.textContent, offline?.textContent,
      ]);
      if (inputs !== budgetInputs) {
        budgetInputs = inputs;
        const focused = dialog.ownerDocument?.activeElement;
        const scrollTop = dialog.scrollTop;
        if (title.parentElement !== head) head.prepend(title);
        if (secondary && secondary.parentElement !== add) add.append(secondary);
        if (offline && offline.parentElement !== foot) foot.append(offline);
        const compact = head.getBoundingClientRect().height
        + (foot?.getBoundingClientRect().height ?? 0) > dialog.clientHeight * .5;
        if (compact) {
          head.after(title);
          if (secondary) foot.before(secondary);
          if (offline) foot.before(offline);
        }
        if (focused && dialog.contains(focused) && dialog.ownerDocument.activeElement !== focused) {
          focused.focus({ preventScroll: true });
          dialog.scrollTop = scrollTop;
        }
      }
    }
    for (const [edge, property] of edges) dialog.style.setProperty(property, `${edge.getBoundingClientRect().height}px`);
  });
  for (const [edge] of edges) observer.observe(edge);
  if (title && close) {
    observer.observe(dialog);
    observer.observe(title);
    if (secondary) observer.observe(secondary);
    if (offline) observer.observe(offline);
  }
  return observer;
}
