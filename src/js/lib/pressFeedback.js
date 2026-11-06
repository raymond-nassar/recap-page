// Chromium can deliver trusted touch pointerdown without matching :active until release.
// Observe the hold without taking over scrolling, selection or the control's own action.
export function wirePressFeedback({ document, window }) {
  const controls = 'button, summary, a.btn, a.mini, a.ri, a.brand, a.mobile-link, a.home-path';
  let held = null;
  const clear = () => {
    held?.node.removeAttribute('data-pressing');
    held = null;
  };
  document.addEventListener('pointerdown', (event) => {
    clear();
    if (!event.isPrimary || event.button !== 0 || !['touch', 'pen'].includes(event.pointerType)) return;
    const node = event.target.closest?.(controls);
    if (!node || node.matches(':disabled, [aria-disabled="true"]')) return;
    held = { node, id: event.pointerId };
    node.setAttribute('data-pressing', '');
  }, { capture: true, passive: true });
  document.addEventListener('pointermove', (event) => {
    if (!held || event.pointerId !== held.id) return;
    const rect = held.node.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom) clear();
  }, { capture: true, passive: true });
  for (const type of ['pointerup', 'pointercancel']) {
    document.addEventListener(type, (event) => {
      if (event.pointerId === held?.id) clear();
    }, { capture: true, passive: true });
  }
  for (const type of ['scroll', 'contextmenu', 'dragstart']) {
    document.addEventListener(type, clear, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  window.addEventListener('blur', clear);
}
