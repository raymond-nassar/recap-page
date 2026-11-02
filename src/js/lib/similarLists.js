import {
  STORY_TONES,
  STORY_TYPES,
  defaultPath,
  groupCatalog,
  isModernTimelineChapterId,
  resolveReadingPaths,
  storyKey,
} from './catalog.js';
import { isRead } from './model.js';

// Suggestions rank by what a list is like, never by what anyone else read or clicked (#1060).
// Everything here is worked out from the bundled catalog and the reader's own saved state.
export const MAX_SIMILAR_LISTS = 3;

// The rule the owner approved on #1060: the quiet line appears once no more than the smaller of 5
// issues or a tenth of the list (at least 1) is left, and only past halfway, so a short list does
// not offer it the moment it is opened.
export function nearEnd({ read, total } = {}) {
  if (!Number.isInteger(read) || !Number.isInteger(total) || total <= 0) return false;
  const unread = total - read;
  const window = Math.max(1, Math.min(5, Math.floor(total / 10)));
  return unread > 0 && unread <= window && read * 2 > total;
}

const owns = (map, key) => map != null && Object.prototype.hasOwnProperty.call(map, key);
const strings = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);

function discoverable(list) {
  return list?.type !== 'screen-companion' && strings(list?.storyTypes).length > 0;
}

function fullyRead(state, ids) {
  if (!Array.isArray(ids) || !ids.length) return false;
  return ids.every((id) => isRead(state, id));
}

const shared = (a, b) => {
  const other = new Set(strings(b));
  return strings(a).filter((value) => other.has(value));
};

const labelled = (keys, labels) => keys.map((key) => labels[key] ?? key).join(', ');

export function similarLists({
  catalog, state, sourceListId, isCompleted, exclude = new Set(), limit = MAX_SIMILAR_LISTS,
} = {}) {
  if (!Array.isArray(catalog?.lists) || !state?.lists || typeof isCompleted !== 'function') return [];
  const source = owns(state.lists, sourceListId) ? state.lists[sourceListId] : null;
  const byId = new Map(catalog.lists.map((entry) => [entry.id, entry]));
  const sourceEntry = byId.get(source?.catalogId);
  if (!sourceEntry || !strings(sourceEntry.storyTypes).length) return [];
  const sourceKey = storyKey(sourceEntry);

  // A story on the same Reading Path, or the next chapter of the Modern Timeline, is the
  // continuation that "What to read next" already offers. Offering it again as "similar" would
  // spend a slot on a list the reader is already pointed at.
  const excluded = new Set([sourceKey]);
  for (const path of resolveReadingPaths(catalog.paths, catalog.lists)) {
    if (path.stops.some((stop) => stop.key === sourceKey)) {
      for (const stop of path.stops) excluded.add(stop.key);
    }
  }
  const chapterSource = isModernTimelineChapterId(sourceEntry.id);

  // A list whose every issue sits inside the source, or inside a saved list already finished, has
  // nothing left to read. Review 5800239b found 13 of 332 shipped lists suggesting one, 8 as the
  // first card. The catalog records containment at build time, so this costs no order fetches.
  const alreadyRead = new Set(strings(sourceEntry.contains));
  const savedByCatalogId = new Map();
  const savedIds = new Set([...(state.listOrder ?? []), ...Object.keys(state.lists)]);
  for (const id of savedIds) {
    const saved = owns(state.lists, id) ? state.lists[id] : null;
    const entry = byId.get(saved?.catalogId);
    if (!entry) continue;
    if (isCompleted(state, id) === true || fullyRead(state, saved.itemIds)) {
      excluded.add(storyKey(entry));
      for (const inside of strings(entry.contains)) alreadyRead.add(inside);
    } else if (!savedByCatalogId.has(entry.id) || id === state.active) {
      savedByCatalogId.set(entry.id, id);
    }
  }

  const sourceYear = Number.isInteger(sourceEntry.timeline) ? sourceEntry.timeline : null;
  const ranked = [];
  for (const story of groupCatalog(catalog.lists)) {
    if (excluded.has(story.key)) continue;
    // A story with a wider path the reader has not read through stays eligible on that path.
    const unread = story.lists.filter((list) => !alreadyRead.has(list.id));
    const entry = defaultPath({ lists: unread }, (list) => savedByCatalogId.has(list.id));
    if (!discoverable(entry) || exclude.has(entry.id)) continue;
    if (chapterSource && isModernTimelineChapterId(entry.id)) continue;
    const types = shared(sourceEntry.storyTypes, entry.storyTypes);
    if (!types.length) continue;
    const tones = shared(sourceEntry.tones, entry.tones);
    const writers = shared(sourceEntry.writers, entry.writers);
    const distance = sourceYear != null && Number.isInteger(entry.timeline)
      ? Math.abs(entry.timeline - sourceYear)
      : Infinity;
    ranked.push({ story, entry, types, tones, writers, distance });
  }
  ranked.sort((a, b) => b.types.length - a.types.length
    || b.tones.length - a.tones.length
    || b.writers.length - a.writers.length
    || a.distance - b.distance
    || a.entry.name.localeCompare(b.entry.name)
    || a.entry.id.localeCompare(b.entry.id));

  return ranked.slice(0, Math.max(0, limit)).map(({ story, entry, types, tones, writers }) => {
    const reasons = [{ type: 'story-type', text: `Same genre: ${labelled(types, STORY_TYPES)}`, keys: types }];
    if (tones.length) {
      reasons.push({ type: 'tone', text: `Same tone: ${labelled(tones, STORY_TONES)}`, keys: tones });
    }
    if (writers.length) {
      reasons.push({ type: 'writer', text: `Same writer: ${writers.join(', ')}`, writers });
    }
    const savedListId = savedByCatalogId.get(entry.id);
    return {
      catalogId: entry.id,
      name: entry.name,
      storyKey: story.key,
      ...(savedListId ? { savedListId } : {}),
      reasons,
    };
  });
}
