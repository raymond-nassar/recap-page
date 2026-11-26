import { eventReadingOrders } from '../../../data/eventReadingOrders.js';
import { READING_ORDERS } from '../../lib/readingOrderChoices.js';
import { formatRoute, isPlainNavigation } from '../../lib/route.js';

export function eventReadingLayout(catalogId, items) {
  if (!Object.hasOwn(eventReadingOrders, catalogId) || !Array.isArray(items)) return null;
  const layout = eventReadingOrders[catalogId];
  return layout.issueOrder.length === items.length
    && items.every(({ issueId }, index) => issueId === layout.issueOrder[index]) ? layout : null;
}

export function eventOrderControls(el, mode, choose) {
  return el('div', { class: 'order-choices', role: 'group', 'aria-label': 'Reading order' },
    Object.entries(READING_ORDERS).map(([order, { label }]) => el('button', {
      type: 'button',
      class: 'order-choice',
      'aria-pressed': String(mode === order),
      dataset: { act: 'event-order', key: order },
      onclick: () => { if (mode !== order) choose(order); },
    }, label)));
}

export function eventBookRows(el, layout, items, {
  catalogId, heading, groupClass, issueRow, openPosition,
}) {
  const titleRow = (title, tag = heading) => el('li', { class: groupClass }, [el(tag, { text: title })]);
  const positionLink = (position, label) => el('a', {
    href: formatRoute({ view: 'new-to-comics', previewId: catalogId, previewPosition: position }),
    dataset: { act: 'event-position', key: position },
    onclick: (event) => {
      if (!isPlainNavigation(event)) return;
      if (openPosition(position)) event.preventDefault();
    },
  }, label);
  const rows = [];
  for (const phase of layout.phases) {
    if (phase.title) rows.push(titleRow(phase.title));
    for (const { title, position, positions, references } of phase.steps) {
      if (title) rows.push(positions
        ? titleRow(title, phase.title ? (heading === 'h3' ? 'h4' : 'h5') : heading)
        : el('li', { class: `${groupClass} rail-hint`, text: title }));
      for (const index of positions ?? (position ? [position] : [])) {
        rows.push(issueRow(items[index - 1], index));
      }
      for (const index of references ?? []) {
        rows.push(el('li', { class: groupClass }, [positionLink(index, items[index - 1].title)]));
      }
    }
  }
  const links = layout.linked.map((position) => el('li', {}, [
    positionLink(position, `${position}. ${items[position - 1].title}`),
  ]));
  rows.push(el('li', { class: groupClass }, [
    el('details', { open: true }, [
      el('summary', { text: READING_ORDERS.issue.label }),
      el('ul', {}, links),
    ]),
  ]));
  return rows;
}
