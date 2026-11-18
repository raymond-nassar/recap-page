const LIMIT = 3;
const IOS_FEATURE_COPY = new Map([
  ['Back up automatically to your own OneDrive on Windows and Android, or move your reading data with one complete backup file.',
    'Move your reading data with one complete backup file.'],
  ['Use clearer phone layouts and screen reader labels, and install the app from Edge when offered.',
    'Use clearer phone layouts and screen reader labels.'],
  ['iPhone and iPad: you can now back up your reading progress to your own iCloud Drive. Open the backup card, choose Connect iCloud and turn on automatic backup; backups appear in a Recap Page folder in the Files app. Recap Page uploads nothing until you turn it on, and the project never receives your backups. If iCloud has not finished uploading a backup, checking for or restoring that backup says so and asks you to try again once iCloud has uploaded it.',
    'You can now back up your reading progress to your own iCloud Drive. Open the backup card, choose Connect iCloud and turn on automatic backup; backups appear in a Recap Page folder in the Files app. Recap Page uploads nothing until you turn it on, and the project never receives your backups. If iCloud has not finished uploading a backup, checking for or restoring that backup says so and asks you to try again once iCloud has uploaded it.'],
]);
// Lines with no part an iPhone or iPad reader can use, reviewed and approved for omission there.
export const IOS_OMITTED_FEATURES = new Set([
  'On Windows, Recap Page can open in its own window when installed as an app in Edge or Chrome. The Microsoft Store version can also be ready when you sign in if you turn that on. Your saved progress stays where it is.',
]);
// OneDrive and a Microsoft account are offered on iPhone and iPad too since 4.5.0 (#1113), so only the
// Microsoft Store still marks a line as another platform's.
const OTHER_PLATFORM_NAMES = /\b(?:Android|Windows|Edge|Google(?: Drive| Play)?|Microsoft Store)\b/;
const VIEWING_FAILURES = {
  unreadable: 'browser storage could not be read',
  'locks-unavailable': 'browser storage locking is unavailable',
  'locks-rejected': 'browser storage locking was refused',
  'write-failed': 'the browser refused the preference write',
  'write-unverified': 'the preference write could not be verified',
  canceled: 'the local viewing record was cleared',
};
const IOS_VIEWING_FAILURES = {
  unreadable: 'app storage could not be read',
  'locks-unavailable': 'app storage locking is unavailable',
  'locks-rejected': 'app storage locking was refused',
  'write-failed': 'the app refused the preference write',
  'write-unverified': 'the preference write could not be verified',
  canceled: 'the local viewing record was cleared',
};

export function createHomeUpdatesView({
  content, seen, el, elements, events, isCurrent, isCovered = () => false, loadCatalog, onPreview, isIos = false,
  firstLaunch = false,
}) {
  const batch = content.batch;
  let wired = false;
  let expanded = false;
  // Home offers the button after an update until the reader has opened these highlights once
  // (#1317). About can reveal it on demand, and that lasts until the reader leaves Home.
  let offered = false;
  let revealed = false;
  let action = 0;
  let disclosure = 0;
  let catalog = null;
  const rows = new Map();
  let viewingMessage = '';
  let catalogMessage = '';

  const visible = () => isCurrent() && !elements().home.hidden;
  const active = (token) => token === action && visible() && elements().details.open;

  function paintPresence() {
    elements().details.hidden = !(offered || revealed);
  }

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
    const features = isIos ? batch.features.flatMap((feature) => {
      if (IOS_OMITTED_FEATURES.has(feature)) {
        return [];
      }
      const projected = IOS_FEATURE_COPY.get(feature) ?? feature;
      if (OTHER_PLATFORM_NAMES.test(projected)) {
        return [];
      }
      return [projected];
    }) : batch.features;
    nodes.content.replaceChildren(
      el('p', { class: 'home-updates-copy', text: `Included in version ${content.version}.` }),
      ...(features.length ? [section('App improvements', features,
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
        const reason = (isIos ? IOS_VIEWING_FAILURES : VIEWING_FAILURES)[result.reason];
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
    // A fresh install has nothing it was updated from, so it records this batch quietly and offers
    // the button only once a later update brings one the reader has not opened. Storage that cannot
    // be read leaves recorded() at 0, so an unreadable record offers the button rather than losing it.
    offered = Boolean(batch) && !firstLaunch && seen.recorded() < batch.id;
    if (batch && firstLaunch && seen.current() < batch.id) void seen.acknowledge(batch.id);
    paintPresence();
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

  // Called as the reader leaves Home, never while Home shows, so an open or just-closed disclosure
  // keeps the toggle that Close and Escape return focus to. Only a verified record hides it, so a
  // refused write leaves the button for the next visit to try again.
  function leaveHome() {
    if (!wired) return;
    revealed = false;
    if (offered && seen.recorded() >= batch.id) offered = false;
    paintPresence();
  }

  // About's entry: the same disclosure, on Home, whatever the record says.
  function open() {
    if (!wired || !batch || !visible()) return false;
    const nodes = elements();
    revealed = true;
    paintPresence();
    nodes.details.open = true;
    nodes.toggle.focus({ preventScroll: true });
    nodes.toggle.scrollIntoView?.({ block: 'nearest' });
    return true;
  }

  return { wire, close, leaveHome, open, available: () => Boolean(batch) };
}
