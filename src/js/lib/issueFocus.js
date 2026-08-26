import { normalizeIssue } from './model.js';
import { availability, describe, SHORT, STATE } from './availability.js';
import { detailUrl, isLaunchable } from '../reader.js';

function issueDate(value) {
  return value ? String(value).slice(0, 10) : '';
}

function credits(issue) {
  return (issue?.creators ?? [])
    .filter((creator) => {
      const role = String(creator.role || '');
      return !/cover/i.test(role) && /writer|pencill?er|artist|inker/i.test(role);
    })
    .slice(0, 3)
    .map((creator) => creator.name);
}

export function issuePresentation(issue, {
  override = null, position = null, total = null, description = '',
} = {}) {
  if (!issue) return null;
  const state = availability(issue, { override });
  const facts = [{
    key: 'In Unlimited',
    value: `${SHORT[state.state]} ${describe(issue, { override })}`,
    className: state.state === STATE.EXPECTED || state.state === STATE.OVERRIDE_AVAILABLE
      ? 'ok'
      : state.state === STATE.SCHEDULED ? 'warn' : '',
  }];
  if (issue.pageCount) facts.push({ key: 'Pages', value: String(issue.pageCount), className: '' });
  if (issueDate(issue.onSale)) facts.push({ key: 'Released', value: issueDate(issue.onSale), className: '' });
  if (Number.isInteger(position) && Number.isInteger(total) && total > 0) {
    facts.push({ key: 'Position', value: `${position} of ${total}`, className: '' });
  }
  const names = credits(issue);
  return {
    title: issue.title,
    seriesName: issue.seriesName ?? '',
    number: issue.number ? `#${issue.number}` : '',
    byline: [issue.seriesName, names.join(' & ') || null].filter(Boolean).join(' · '),
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
