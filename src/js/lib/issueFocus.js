import { normalizeIssue } from './model.js';
import { availability, describe, RECORD_HEADING, RECORD_NOTE, STATE } from './availability.js';
import { detailUrl, isLaunchable } from '../reader.js';
import { ApiError } from '../api.js';

function issueDate(value) {
  return value ? String(value).slice(0, 10) : '';
}

// #1061: creators are credited by the role the metadata records. Across the bundled orders the
// roles are writer, penciler, cover artist, penciler (cover), colorist, inker, editor and letterer;
// anything else is shown as recorded, after these.
const ROLE_LABELS = [
  ['writer', 'Writer'],
  ['artist', 'Artist'],
  ['penciler', 'Penciler'],
  ['penciller', 'Penciler'],
  ['inker', 'Inker'],
  ['colorist', 'Colorist'],
  ['letterer', 'Letterer'],
  ['cover artist', 'Cover artist'],
  ['penciler (cover)', 'Cover penciler'],
  ['editor', 'Editor'],
];
const ROLE_ORDER = [...new Set(ROLE_LABELS.map(([, label]) => label))];

function roleLabel(role) {
  const key = role.trim().toLowerCase();
  const known = ROLE_LABELS.find(([name]) => name === key);
  if (known) return known[1];
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function credits(issue) {
  const roles = new Map();
  const unroled = [];
  for (const creator of issue?.creators ?? []) {
    const name = String(creator?.name ?? '').trim();
    if (!name) continue;
    const role = String(creator.role ?? '').trim();
    if (!role) {
      unroled.push(name);
      continue;
    }
    const label = roleLabel(role);
    const names = roles.get(label) ?? [];
    if (!names.includes(name)) names.push(name);
    roles.set(label, names);
  }
  const rank = (label) => {
    const at = ROLE_ORDER.indexOf(label);
    return at < 0 ? ROLE_ORDER.length : at;
  };
  const byRole = [...roles].sort(([a], [b]) => rank(a) - rank(b))
    .map(([key, names]) => ({ key, value: names.join(', '), className: '' }));
  return { byRole, unroled: unroled.slice(0, 3) };
}

export function issuePresentation(issue, {
  override = null, position = null, total = null, description = '',
} = {}) {
  if (!issue) return null;
  const state = availability(issue, { override });
  const { byRole, unroled } = credits(issue);
  // detailsOnly facts appear in Issue details and not on the reading card (#1061): the card's
  // progress bar already says where the reader is, and the record is reference, not a next step.
  const facts = [{
    key: RECORD_HEADING,
    hint: RECORD_NOTE,
    value: describe(issue, { override }),
    className: state.state === STATE.EXPECTED || state.state === STATE.OVERRIDE_AVAILABLE
      ? 'ok'
      : state.state === STATE.SCHEDULED ? 'warn' : '',
    detailsOnly: true,
  }, ...byRole];
  if (issue.pageCount) facts.push({ key: 'Pages', value: String(issue.pageCount), className: '' });
  if (issueDate(issue.onSale)) facts.push({ key: 'Released', value: issueDate(issue.onSale), className: '' });
  if (Number.isInteger(position) && Number.isInteger(total) && total > 0) {
    facts.push({ key: 'Position', value: `${position} of ${total}`, className: '', detailsOnly: true });
  }
  return {
    title: issue.title,
    seriesName: issue.seriesName ?? '',
    number: issue.number ? `#${issue.number}` : '',
    byline: [issue.seriesName, unroled.join(' & ') || null].filter(Boolean).join(' · '),
    description,
    facts,
    detailUrl: detailUrl(issue),
    launchable: isLaunchable(issue),
  };
}

function listContext(state, id, issueId) {
  const list = state?.lists?.[id];
  const position = list?.itemIds?.indexOf(issueId) ?? -1;
  if (!list || position < 0) return null;
  return {
    kind: 'list',
    id,
    name: list.name,
    position: position + 1,
    total: list.itemIds.length,
    collectedIn: null,
    read: Object.hasOwn(state.read ?? {}, issueId),
    readAt: state.read?.[issueId] ?? null,
    note: state.notes?.[issueId] ?? '',
    override: state.overrides?.[issueId] ?? null,
  };
}

async function orderContext(catalog, id, issueId, loadOrder, signal) {
  const entry = catalog?.lists?.find((list) => list.id === id);
  if (!entry || typeof loadOrder !== 'function') return null;
  const order = await loadOrder(entry.file, { signal });
  const items = Array.isArray(order?.items) ? order.items : [];
  const position = items.findIndex((item) => Number(item?.issueId) === issueId);
  if (position < 0) return null;
  const issue = normalizeIssue(items[position]);
  if (!issue) return null;
  return {
    issue,
    context: {
      kind: 'order',
      id,
      name: entry.name,
      position: position + 1,
      total: items.length,
      collectedIn: typeof items[position].collectedIn === 'string'
        ? items[position].collectedIn
        : null,
      read: false,
      readAt: null,
      note: '',
      override: null,
    },
  };
}

function aborted(error, signal) {
  return signal?.aborted || error?.name === 'AbortError';
}

export async function resolveIssueFocus({
  issueId, context = null, state, catalog = null, loadOrder, api, signal,
}) {
  let issue = normalizeIssue(state?.issues?.[issueId]);
  let source = issue ? 'saved' : 'unavailable';
  let resolvedContext = null;
  let contextStatus = context ? 'stale' : 'none';
  let contextError = null;

  if (context?.kind === 'list') {
    resolvedContext = listContext(state, context.id, issueId);
    if (resolvedContext) contextStatus = 'valid';
  } else if (context?.kind === 'order') {
    try {
      const bundled = await orderContext(catalog, context.id, issueId, loadOrder, signal);
      if (bundled) {
        resolvedContext = bundled.context;
        contextStatus = 'valid';
        if (!issue) {
          issue = bundled.issue;
          source = 'bundled';
        }
      }
    } catch (error) {
      if (aborted(error, signal)) throw error;
      contextError = error;
    }
  }

  if (!issue && issueId > 0 && api?.issue) {
    try {
      issue = normalizeIssue(await api.issue(issueId, { signal }));
      if (issue) source = 'api';
    } catch (error) {
      if (aborted(error, signal)) throw error;
      return {
        issue: null,
        source: 'unavailable',
        context: resolvedContext,
        contextStatus,
        error,
        contextError,
        failure: error instanceof TypeError
          || (error instanceof ApiError && (error.transient || error.status === 408))
          ? 'transient'
          : error instanceof ApiError && (error.status === 404 || error.status === 410)
            ? 'not-found'
            : 'unavailable',
      };
    }
  }

  return {
    issue,
    source: issue ? source : 'unavailable',
    context: resolvedContext,
    contextStatus,
    error: issue ? null : contextError,
    contextError,
  };
}
