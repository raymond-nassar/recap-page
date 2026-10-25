const GAP = 8;
const EDGE = 8;

export function tooltipRegions(box, viewport, preferRight = false) {
  const { left = 0, top = 0, width, height } = viewport;
  const right = left + width - EDGE;
  const bottom = top + height - EDGE;
  const x = left + EDGE;
  const y = top + EDGE;
  const regions = {
    top: { left: x, top: y, width: right - x, height: box.top - GAP - y },
    bottom: { left: x, top: box.bottom + GAP, width: right - x, height: bottom - box.bottom - GAP },
    right: { left: box.right + GAP, top: y, width: right - box.right - GAP, height: bottom - y },
    left: { left: x, top: y, width: box.left - GAP - x, height: bottom - y },
  };
  return (preferRight ? ['right', 'left', 'bottom', 'top'] : ['top', 'bottom', 'right', 'left'])
    .map((side) => ({ side, ...regions[side] }))
    .filter((region) => region.width > 0 && region.height > 0);
}

// Picks the side a hint goes on: the first side where it fits, else the roomiest with internal
// scrolling, as it always has. If that spot would cover content marked data-keep-uncovered, such as
// Done's result, which confirms the change just made or says it failed (#855), the hint gives way and
// is not shown. Measured on 2026-10-25, with Done near the top of the window the spot was below Done,
// over the result, for Done's hint and for Read's. The hint does not move to another side instead: on
// a phone the only other room is a 25px sliver beside a full-width button, and at 1280px Read's hint,
// moved to its right, sat on Done. A hint is a supplement, and Fluent's tooltip guidance asks that a
// tooltip not obscure important information.
export function tooltipPlacement(regions, measure, keep = []) {
  const covers = (spot) => keep.some((other) => spot.left < other.right && other.left < spot.right
    && spot.top < other.bottom && other.top < spot.bottom);
  const spots = new Map();
  let chosen = null;
  for (const region of regions) {
    const { fits, spot } = measure(region);
    spots.set(region, spot);
    if (fits) {
      chosen = region;
      break;
    }
  }
  chosen ??= regions.reduce((best, region) => (!best || region.width * region.height > best.width * best.height ? region : best), null);
  return chosen && !covers(spots.get(chosen)) ? chosen : null;
}

// Both families are visual supplements. Names and shortcut metadata stay on the controls;
// repainting a hint must not create another accessible description or live announcement.
export function wireTooltips({ resolve, document: doc = document, window: win = window }) {
  let active = null;
  let pointer = null;
  let point = null;
  let focused = doc.activeElement;
  const suppressed = new Set();
  const contains = (root, node) => node instanceof win.Node && root.contains(node);
  const held = (trigger) => contains(trigger, pointer) || contains(trigger, focused);
  const dismiss = () => {
    if (!active) return;
    active.tip.hidden = true;
    active = null;
  };
  const release = () => {
    for (const trigger of suppressed) {
      if (!trigger.isConnected || !held(trigger)) suppressed.delete(trigger);
    }
  };
  const suppress = () => {
    if (active) suppressed.add(active.trigger);
    dismiss();
    release();
  };
  const valid = (trigger) => trigger.isConnected
    && !trigger.matches(':disabled, [aria-disabled="true"]')
    && !trigger.closest('[hidden], [inert]')
    && trigger.checkVisibility({ checkVisibilityCSS: true })
    && (!doc.querySelector('dialog[open]') || Boolean(trigger.closest('dialog[open]')));

  function position() {
    const { trigger, tip, preferRight } = active;
    const content = tip.firstElementChild;
    const box = trigger.getBoundingClientRect();
    const viewport = win.visualViewport;
    const visible = {
      left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
      width: viewport?.width ?? win.innerWidth, height: viewport?.height ?? win.innerHeight,
    };
    if (box.right <= visible.left || box.left >= visible.left + visible.width
        || box.bottom <= visible.top || box.top >= visible.top + visible.height) return dismiss();
    const regions = tooltipRegions(box, visible, preferRight);
    const keep = [...doc.querySelectorAll('[data-keep-uncovered]')]
      .filter((node) => node.getClientRects().length).map((node) => node.getBoundingClientRect());
    const size = (region) => {
      tip.style.maxWidth = `${Math.min(320, region.width)}px`;
      content.style.maxHeight = `${Math.max(0, region.height - 2)}px`;
    };
    const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
    // Where the hint lands on a side, at the size that side allows.
    const spot = (region) => {
      const { width, height } = tip.getBoundingClientRect();
      let left = clamp(box.left + (box.width - width) / 2, region.left, region.left + region.width - width);
      let top = clamp(box.top + (box.height - height) / 2, region.top, region.top + region.height - height);
      if (region.side === 'top') top = box.top - GAP - height;
      if (region.side === 'bottom') top = box.bottom + GAP;
      if (region.side === 'left') left = box.left - GAP - width;
      if (region.side === 'right') left = box.right + GAP;
      return { left, top, right: left + width, bottom: top + height };
    };
    // Try the preferred side first, then the alternatives before allowing internal scrolling.
    const chosen = tooltipPlacement(regions, (region) => {
      size(region);
      return {
        fits: content.scrollWidth <= content.clientWidth && content.scrollHeight <= content.clientHeight,
        spot: spot(region),
      };
    }, keep);
    if (!chosen) return dismiss();
    size(chosen);
    const { left, top } = spot(chosen);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.dataset.side = chosen.side;
  }

  function crossingGap() {
    if (!active || !point) return false;
    const control = active.trigger.getBoundingClientRect();
    const hint = active.tip.getBoundingClientRect();
    const side = active.tip.dataset.side;
    const vertical = side === 'top' || side === 'bottom';
    const left = vertical ? Math.min(control.left, hint.left) : Math.min(control.right, hint.right);
    const right = vertical ? Math.max(control.right, hint.right) : Math.max(control.left, hint.left);
    const top = vertical ? Math.min(control.bottom, hint.bottom) : Math.min(control.top, hint.top);
    const bottom = vertical ? Math.max(control.top, hint.top) : Math.max(control.bottom, hint.bottom);
    return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  }

  function refresh() {
    release();
    if (!active) return;
    const next = resolve(active.trigger);
    if (!valid(active.trigger) || !next || next.trigger !== active.trigger
        || (!held(active.trigger) && !contains(active.tip, pointer) && !crossingGap())) return dismiss();
    if (active.tip.textContent !== next.text) active.tip.firstElementChild.textContent = next.text;
    active.preferRight = next.preferRight;
    position();
  }

  function show(node) {
    release();
    const next = node instanceof win.Element ? resolve(node) : null;
    if (!next || suppressed.has(next.trigger) || !valid(next.trigger)) return refresh();
    if (active?.trigger !== next.trigger) dismiss();
    active = next;
    if (next.tip.textContent !== next.text) next.tip.firstElementChild.textContent = next.text;
    next.tip.hidden = false;
    position();
  }

  doc.addEventListener('pointerover', (event) => {
    pointer = event.target;
    point = { x: event.clientX, y: event.clientY };
    if (active && contains(active.tip, pointer)) return;
    show(pointer);
  });
  doc.addEventListener('pointerout', (event) => {
    pointer = event.relatedTarget;
    point = pointer ? { x: event.clientX, y: event.clientY } : null;
    refresh();
  });
  // A geometric corridor keeps slow pointer travel valid without placing a hit area over
  // the control's focus ring or stealing clicks from adjacent controls.
  doc.addEventListener('pointermove', (event) => {
    point = { x: event.clientX, y: event.clientY };
    refresh();
  });
  doc.addEventListener('focusin', (event) => {
    focused = event.target;
    show(focused);
  });
  doc.addEventListener('focusout', (event) => {
    focused = event.relatedTarget;
    refresh();
  });
  doc.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !active) return;
    suppress();
    // The next Escape still belongs to the row disclosure or dialog. This one only removes
    // the hint, so those handlers must not move focus out from under its reader.
    event.preventDefault();
    event.stopPropagation();
  }, true);
  win.addEventListener('hashchange', suppress);
  win.addEventListener('resize', refresh);
  win.addEventListener('scroll', refresh, true);
  win.visualViewport?.addEventListener('resize', refresh);
  win.visualViewport?.addEventListener('scroll', refresh);
  new win.MutationObserver((records) => {
    if (records.some((record) => !(record.target.parentElement?.closest('.visual-tooltip')
      || record.target.closest?.('.visual-tooltip')))) refresh();
  }).observe(doc.body, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['class', 'hidden', 'disabled', 'aria-disabled', 'inert', 'open', 'data-tooltip', 'data-tip'],
  });
  return { refresh, dismiss: suppress };
}
