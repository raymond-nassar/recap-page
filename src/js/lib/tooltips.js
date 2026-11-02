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
// over the result, for Done's hint and for Read's. A hint is a supplement, and Fluent's tooltip
// guidance asks that a tooltip not obscure important information.
//
// A spot over another command in the trigger's data-tooltip-group is treated differently (#860).
// Stacked on a narrow screen, Done's hint covered a third of Read and took the clicks meant for it,
// and at 200 per cent text nearly all of Read. Giving way there would hide the only visible mention
// of the D shortcut wherever the two are stacked, so the hint tries the other sides in order and
// takes the first where it fits, at least as wide as at its usual spot, over neither a command in its
// group nor kept content. Otherwise it gives way. The width keeps it out of the sliver beside a
// full-width button, where at 640px Read's hint became a column 33px wide and 182px tall, and the
// group keeps a moved hint off its neighbour, as when Read's hint moved right onto Done at 1280px.
export function tooltipPlacement(regions, measure, keep = [], neighbours = []) {
  const overlaps = (spot, rects) => rects.some((other) => spot.left < other.right && other.left < spot.right
    && spot.top < other.bottom && other.top < spot.bottom);
  const width = (spot) => spot.right - spot.left;
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
  if (!chosen || overlaps(spots.get(chosen), keep)) return null;
  if (!overlaps(spots.get(chosen), neighbours)) return chosen;
  const usual = width(spots.get(chosen));
  for (const region of regions) {
    if (region === chosen) continue;
    const { fits, spot } = measure(region);
    // Half a pixel absorbs the rounding in a width recomputed from a different left edge.
    if (fits && width(spot) >= usual - 0.5 && !overlaps(spot, keep) && !overlaps(spot, neighbours)) return region;
  }
  return null;
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
    const group = trigger.closest('[data-tooltip-group]');
    const neighbours = group ? [...group.querySelectorAll('button, a[href]')]
      .filter((node) => node !== trigger && node.getClientRects().length).map((node) => node.getBoundingClientRect()) : [];
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
    }, keep, neighbours);
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
    // A pixel of overlap with both edges, because pointers land on whole pixels and hit testing snaps
    // while the hint's edge may not. Measured on #1061's reading card at 1280x900, the hint's foot was
    // at y 367.36: the pointer's step to 367 hit the card instead, fell outside a corridor that began at
    // 367.36, and the hint closed under a pointer travelling onto it.
    return point.x >= left - 1 && point.x <= right + 1 && point.y >= top - 1 && point.y <= bottom + 1;
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
