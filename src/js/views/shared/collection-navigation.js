export function createCollectionNavigation({
  el, id, label, entries, isCurrent, getTarget, getNext,
}) {
  const choices = new Map(entries.map((entry, index) => [`entry:${entry.id}`, { ...entry, index }]));
  const select = el('select', {
    id,
    'aria-describedby': `${id}-status`,
  }, [
    el('option', { value: '', text: 'Choose a destination' }),
    ...(getNext ? [el('option', { value: 'next-unfinished', text: 'Next unfinished stop' })] : []),
    ...[...choices].map(([value, entry]) => el('option', {
      value,
      text: `${entry.name} (${entry.index + 1} of ${entries.length})`,
    })),
  ]);
  const status = el('p', { id: `${id}-status`, role: 'status', class: 'rail-hint' });
  const unavailable = () => { status.textContent = 'That stop or Reading List is no longer available.'; };
  return el('form', {
    class: 'collection-navigation',
    onsubmit: (event) => {
      event.preventDefault();
      if (!isCurrent()) return;
      const value = select.value;
      if (!value) {
        status.textContent = 'Choose a stop or Reading List to jump to.';
        return;
      }
      let entry;
      if (value === 'next-unfinished') {
        if (!getNext) { unavailable(); return; }
        const next = getNext();
        if (!isCurrent()) return;
        if (next.kind === 'complete') {
          status.textContent = 'All displayed stops are marked as completed.';
          return;
        }
        entry = choices.get(`entry:${next.id}`);
      } else entry = choices.get(value);
      if (!entry) { unavailable(); return; }
      const target = getTarget(entry.id);
      if (!isCurrent()) return;
      if (!target?.isConnected) { unavailable(); return; }
      target.focus();
      target.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      status.textContent = `Jumped to ${entry.name} (${entry.index + 1} of ${entries.length}).`;
    },
  }, [
    el('label', { for: id, text: label }),
    select,
    el('button', { type: 'submit', class: 'btn btn-g', text: 'Jump', disabled: entries.length === 0 }),
    status,
  ]);
}
