const LIMIT = 3;
const VIEWING_FAILURES = {
  unreadable: 'browser storage could not be read',
  'locks-unavailable': 'browser storage locking is unavailable',
  'locks-rejected': 'browser storage locking was refused',
  'write-failed': 'the browser refused the preference write',
  'write-unverified': 'the preference write could not be verified',
  canceled: 'the local viewing record was cleared',
};

export function createHomeUpdatesView({
  content, seen, el, elements, events, isCurrent, isCovered = () => false, loadCatalog, onPreview,
}) {
  const batch = content.batch;
  let wired = false;
  let expanded = false;
  let action = 0;
  let disclosure = 0;
  let catalog = null;
  const rows = new Map();
  let viewingMessage = '';
  let catalogMessage = '';

  const visible = () => isCurrent() && !elements().home.hidden;
  const active = (token) => token === action && visible() && elements().details.open;

  function paintMarker() {
    const nodes = elements();
    const fresh = Boolean(batch && seen.current() < batch.id);
    nodes.marker.hidden = !fresh;
    nodes.toggle.setAttribute('aria-label', fresh ? "What's new, new highlights" : "What's new");
  }

  function paintStatus() {
    const nodes = elements();
    nodes.status.textContent = [viewingMessage, catalogMessage].filter(Boolean).join(' ');
    nodes.status.hidden = !nodes.status.textContent;
  }

  function section(title, values, renderRow, moreLabel, kind) {
    const first = el('ul', {}, values.slice(0, LIMIT).map(renderRow));
    const children = [el('h3', { text: title }), first];
    if (values.length > LIMIT) {
      children.push(el('details', { class: 'home-updates-more' }, [
        el('summary', { text: moreLabel }),
        el('ul', {}, values.slice(LIMIT).map(renderRow)),
      ]));
    }
    return el('section', { dataset: { homeUpdatesSection: kind } }, children);
  }

  function renderList(id) {
    const entry = catalog?.lists.find((list) => list.id === id);
    const label = entry?.name ?? `${id}: ${catalog ? 'not found in this copy' : 'loading name'}`;
    const name = el('span', { text: label });
    const button = el('button', {
      type: 'button', class: 'btn btn-g', text: 'Preview',
      'aria-label': `Preview: ${label}`, disabled: !entry,
      dataset: { homeUpdatesList: id },
      onclick: () => { void preview(id); },
    });
    rows.set(id, { name, button });
    return el('li', { class: 'home-updates-list' }, [name, button]);
  }

  function paintNames() {
    for (const [id, row] of rows) {
      const entry = catalog.lists.find((list) => list.id === id);
      const label = entry?.name ?? `${id}: not found in this copy`;
      row.name.textContent = label;
      row.button.disabled = !entry;
      row.button.setAttribute('aria-label', `Preview: ${label}`);
    }
  }

  function paintContent() {
    const nodes = elements();
    if (!batch) {
      nodes.content.replaceChildren(el('p', { text: 'No new highlights in this copy.' }));
      return;
    }
    nodes.content.replaceChildren(
      el('p', { class: 'home-updates-copy', text: `Included in version ${content.version}.` }),
      ...(batch.features.length ? [section('App improvements', batch.features,
        (text) => el('li', { text }), 'More app improvements', 'features')] : []),
      ...(batch.listIds.length ? [section('New Reading Lists', batch.listIds,
        renderList, 'More new Reading Lists', 'lists')] : []),
    );
  }

  async function loadNames() {
    if (!batch?.listIds.length) return;
    const token = ++action;
    catalogMessage = 'Loading Reading List names.';
    elements().retry.hidden = true;
    paintStatus();
    try {
      const loaded = await loadCatalog();
      if (!active(token)) return;
      catalog = loaded;
      const missing = batch.listIds.filter((id) => !catalog.lists.some((list) => list.id === id));
      catalogMessage = missing.length ? `Reading Lists not found in this copy: ${missing.join(', ')}. Retry the catalog.` : '';
      elements().retry.hidden = !missing.length;
      paintNames();
      paintStatus();
    } catch (error) {
      if (!active(token)) return;
      catalogMessage = `Reading List names could not be loaded: ${error.message}. Retry the catalog.`;
      elements().retry.hidden = false;
      paintStatus();
    }
  }

  function close({ restoreFocus = true } = {}) {
    action += 1;
    disclosure += 1;
    const nodes = elements();
    if (!visible() || !nodes.details.open) return false;
    nodes.details.open = false;
    expanded = false;
    if (restoreFocus && !isCovered()) nodes.toggle.focus({ preventScroll: true });
    return true;
  }

  async function preview(id) {
    const token = ++action;
    catalogMessage = 'Loading Reading List.';
    paintStatus();
    let entry;
    try {
      const loaded = await loadCatalog();
      if (!active(token)) return;
      entry = loaded.lists.find((list) => list.id === id);
      if (!entry) throw new Error(`Reading List ${id} is not in this copy`);
    } catch (error) {
      if (!active(token)) return;
      catalogMessage = `${error.message}. Retry the catalog, then choose Preview again.`;
      elements().retry.hidden = false;
      paintStatus();
      return;
    }
    close({ restoreFocus: true });
    onPreview(entry);
  }

  async function toggle() {
    const nodes = elements();
    if (expanded === nodes.details.open) return;
    expanded = nodes.details.open;
    if (!expanded) {
      action += 1;
      disclosure += 1;
      return;
    }
    const token = ++disclosure;
    if (!visible()) {
      nodes.details.open = false;
      expanded = false;
      return;
    }
    viewingMessage = '';
    catalogMessage = '';
    if (batch?.listIds.length && !catalog) void loadNames();
    if (batch) {
      const acknowledgment = seen.acknowledge(batch.id);
      paintMarker();
      const result = await acknowledgment;
      if (token !== disclosure || !visible() || !nodes.details.open) return;
      if (!result.remembered) {
        const reason = VIEWING_FAILURES[result.reason];
        if (!reason) throw new Error(`Unsupported viewing outcome: ${result.reason}`);
        viewingMessage = `Viewing could not be remembered: ${reason}. New may return next visit. Your reading data is unchanged.`;
      }
    }
    paintMarker();
    paintStatus();
  }

  function wire() {
    if (wired) return;
    const nodes = elements();
    wired = true;
    nodes.details.open = false;
    paintContent();
    paintMarker();
    nodes.details.addEventListener('toggle', toggle);
    nodes.close.addEventListener('click', () => close());
    nodes.retry.addEventListener('click', () => { void loadNames(); });
    const { document: doc, window: host } = events();
    doc.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || event.key !== 'Escape' || isCovered()) return;
      if (close()) event.preventDefault();
    }, { capture: true });
    doc.addEventListener('pointerdown', (event) => {
      if (!nodes.details.contains(event.target)) close({ restoreFocus: false });
    });
    host.addEventListener('storage', (event) => {
      if (!seen.handleStorageEvent(event)) return;
      paintMarker();
      if (seen.status().reason === 'reset') {
        disclosure += 1;
        viewingMessage = 'The local viewing record was cleared. Close and open again to remember this visit.';
        paintStatus();
      }
    });
  }

  return { wire, close };
}
