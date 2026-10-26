// Progress at a glance (#876): the read count set larger than the words after it, over a slim bar in
// the brand accent, on Home's Continue reading card and the reading screen's hero. Both surfaces write
// it here, so the two can never disagree about a number. It is derived from saved progress, so nothing
// new is stored and a backup carries nothing new.

// The fill's width as a share of the bar, written the way Home has always written it: to one decimal
// place, and a bare zero for a list with no issues, where there is nothing to divide by.
export function glanceShare(read, total) {
  return `${total ? ((read / total) * 100).toFixed(1) : 0}%`;
}

// Writes the read figure and then `words` into `count`, and the share into `fill`. The figure's
// missing digits, against the total's, are handed to the stylesheet, which holds their room after the
// last word, so the line keeps one width from 0 read to all of them. The last word is set apart only
// so that the room cannot wrap onto a line of its own.
export function paintGlance(el, { count, fill }, { read, total }, words) {
  const [, lead, last] = /^([\s\S]*?)(\S+)$/.exec(words) ?? [words, words, ''];
  count.replaceChildren(el('b', { class: 'glance-n', text: String(read) }), lead, el('span', { class: 'glance-end', text: last }));
  count.style.setProperty('--glance-spare', String(String(total).length - String(read).length));
  fill.style.setProperty('--glance-share', glanceShare(read, total));
}
