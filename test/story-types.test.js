import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  HOME_CATEGORIES, STORY_TONES, STORY_TYPES, STORY_TYPES_ROUTE, STORY_TYPE_STARTERS, availableHomeCategories,
  catalogEntries, parseCatalog, storyTypeFacets, storyTypeStarters, storyTypeStories,
} from '../src/js/lib/catalog.js';
import { createStoryTypesView } from '../src/js/views/story-types.js';

const list = (id, storyTypes, tones = [], extra = {}) => ({
  id, name: id, issues: [], storyTypes, tones, ...extra,
});
const fixture = () => catalogEntries([
  list('cap', ['espionage', 'thriller'], ['street-level']),
  list('knights', ['espionage'], ['dark']),
  list('cosmic', ['space-opera'], ['epic']),
  list('untagged', []),
  list('mcu', ['espionage'], ['dark'], { type: 'screen-companion' }),
]);
const ids = (stories) => stories.map((story) => story.lists[0].id);

test('story type browsing narrows by type and tone and leaves out MCU Prep and untagged lists', () => {
  const stories = fixture();
  assert.deepEqual(ids(storyTypeStories(stories)), ['cap', 'knights', 'cosmic']);
  assert.deepEqual(ids(storyTypeStories(stories, { type: 'espionage' })), ['cap', 'knights']);
  assert.deepEqual(ids(storyTypeStories(stories, { tone: 'dark' })), ['knights']);
  assert.deepEqual(ids(storyTypeStories(stories, { type: 'espionage', tone: 'epic' })), []);
});

test('each facet counts what choosing it would show and keeps an empty current choice', () => {
  const facets = storyTypeFacets(fixture(), { type: 'espionage', tone: 'epic' });
  assert.deepEqual(facets.types, [{ key: 'space-opera', label: STORY_TYPES['space-opera'], count: 1 }, {
    key: 'espionage', label: STORY_TYPES.espionage, count: 0,
  }].sort((a, b) => Object.keys(STORY_TYPES).indexOf(a.key) - Object.keys(STORY_TYPES).indexOf(b.key)));
  assert.deepEqual(facets.tones, [
    { key: 'epic', label: STORY_TONES.epic, count: 0 },
    { key: 'street-level', label: STORY_TONES['street-level'], count: 1 },
    { key: 'dark', label: STORY_TONES.dark, count: 1 },
  ]);
});

test('the Genres card counts every tagged list outside MCU Prep', () => {
  const category = availableHomeCategories(fixture(), HOME_CATEGORIES)
    .find(({ key }) => key === STORY_TYPES_ROUTE);
  assert.equal(category.count, 3);
});

test('#1060: the ten starting lists all exist and show as the exact versions the owner chose', () => {
  const expected = [
    'spider-man-best-of', 'iron-man-reading-order', 'captain-america-best-of', 'planet-hulk',
    'thor-best-of', 'marvel-knights-to-planet-x-10', 'xmen-claremont', 'essential-avengers',
    'black-panther-reading-order', 'deadpool-best-of',
  ];
  assert.deepEqual([...STORY_TYPE_STARTERS], expected);
  assert.equal(new Set(expected).size, 10);
  const catalog = parseCatalog(JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8')));
  const ids = new Set(catalog.lists.map((list) => list.id));
  for (const id of STORY_TYPE_STARTERS) assert.ok(ids.has(id), `${id} is in the catalog`);
  const shown = storyTypeStarters(catalogEntries(catalog.lists));
  assert.deepEqual(shown.map((story) => story.lists[0].id), expected);
  for (const story of shown) assert.equal(storyTypeStories([story]).length, 1, `${story.lists[0].id} can appear on Genres`);
  const claremont = shown.find((story) => story.lists[0].id === 'xmen-claremont');
  assert.equal(claremont.lists[0].count, 318);
});

test('#1060: a starting list that leaves the catalog or Genres is skipped', () => {
  const stories = catalogEntries([
    list('kept', ['espionage']),
    list('mcu', ['espionage'], [], { type: 'screen-companion' }),
    list('untagged', []),
  ]);
  assert.deepEqual(ids(storyTypeStarters(stories, ['gone', 'mcu', 'untagged', 'kept'])), ['kept']);
  assert.deepEqual(storyTypeStarters(stories, ['gone']), []);
});

test('the view keeps known selections in labeled native dropdowns without replacing the controls', () => {
  const el = (tag, props = {}, children = []) => ({
    tag, props, id: props.id, children: [children].flat(),
    replaceChildren(...next) { this.children = next; },
    append(...next) { this.children.push(...next); },
    querySelector: () => null,
  });
  const count = { textContent: '' };
  const results = el('div');
  const navigations = [];
  const view = createStoryTypesView({
    el,
    elements: () => ({ count, results }),
    isCurrent: () => true,
    presentation: { catalogCard: (story) => ({ card: story.lists[0].id }) },
    onNavigate: ({ push }) => navigations.push({ ...view.selection(), push }),
  });
  view.set({ storyType: 'espionage', tone: 'grim' });
  assert.deepEqual(view.selection(), { storyType: 'espionage', tone: null });
  view.render({ lists: fixture().map((story) => story.lists[0]) });
  assert.equal(count.textContent, '2 of 3 Reading Lists');
  const root = view.controls();
  const [type, tone] = root.children.map((group) => group.children[1]);
  assert.deepEqual([type.tag, tone.tag], ['select', 'select']);
  assert.deepEqual(root.children.map((group) => group.children[0].props.for), [type.id, tone.id]);
  assert.deepEqual(root.children.map((group) => group.children[0].props.text), ['Genre', 'Tone']);
  assert.deepEqual([type.value, tone.value], ['espionage', '']);
  assert.equal(type.children[0].props.text, 'Any genre');
  assert.equal(tone.children[0].props.text, 'Any tone');
  assert.ok(type.children.some(({ props }) => props.text === 'Espionage (2)'));
  tone.props.onchange({ currentTarget: { value: 'dark' } });
  assert.deepEqual(navigations.at(-1), { storyType: 'espionage', tone: 'dark', push: true });
  assert.equal(count.textContent, '1 of 3 Reading Lists');
  assert.deepEqual(root.children.map((group) => group.children[1]), [type, tone]);
  assert.equal(tone.value, 'dark');
  view.set({ storyType: 'space-opera', tone: 'dark' });
  view.render({ lists: fixture().map((story) => story.lists[0]) });
  assert.deepEqual([type.value, tone.value], ['space-opera', 'dark']);
  assert.ok(type.children.some(({ props }) => props.text === 'Space opera (0)'));
  assert.equal(count.textContent, '0 of 3 Reading Lists');
  tone.props.onchange({ currentTarget: { value: '' } });
  assert.deepEqual(navigations.at(-1), { storyType: 'space-opera', tone: null, push: true });
  type.props.onchange({ currentTarget: { value: '' } });
  assert.deepEqual(view.selection(), { storyType: null, tone: null });
  assert.equal(count.textContent, '3 Reading Lists');
  assert.equal(results.children[0].props.text, 'Choose a genre or a tone to see its Reading Lists.');
  assert.deepEqual(root.children.map((group) => group.children[1]), [type, tone]);
  const key = (key) => type.props.onkeydown({ key });
  const change = (value) => type.props.onchange({ currentTarget: { value } });
  key('ArrowDown');
  change('espionage');
  key('s');
  change('space-opera');
  assert.deepEqual(navigations.slice(-2).map(({ push }) => push), [true, false]);
  type.props.onfocusout();
  key('Home');
  change('');
  assert.equal(navigations.at(-1).push, true);
  type.props.onpointerdown();
  change('espionage');
  assert.equal(navigations.at(-1).push, true);
});

test('#1060: with no choice the view shows the starting lists, gives way to a filter and returns on reset', () => {
  const el = (tag, props = {}, children = []) => ({
    tag, props, id: props.id, children: [children].flat(),
    replaceChildren(...next) { this.children = next; },
    append(...next) { this.children.push(...next); },
  });
  const count = { textContent: '' };
  const results = el('div');
  const view = createStoryTypesView({
    el,
    elements: () => ({ count, results }),
    isCurrent: () => true,
    presentation: { catalogCard: (story) => ({ card: story.lists[0].id }) },
    onNavigate: () => {},
  });
  const starter = STORY_TYPE_STARTERS[1];
  const catalog = { lists: [list('cap', ['espionage']), list(starter, ['science-fiction']), list(STORY_TYPE_STARTERS[0], ['crime-noir'])] };
  const shown = () => {
    const section = results.children[0];
    const grid = section.children.at(-1);
    return { heading: section.children[0].props.text, cards: grid.children.map(({ card }) => card) };
  };
  view.render(catalog);
  assert.deepEqual(shown(), { heading: 'Popular places to start', cards: [STORY_TYPE_STARTERS[0], starter] });
  assert.equal(results.children[0].children[1].props.text, 'Or choose a genre or tone above.');
  assert.equal(count.textContent, '3 Reading Lists');
  const [type] = view.controls().children.map((group) => group.children[1]);
  type.props.onchange({ currentTarget: { value: 'espionage' } });
  assert.deepEqual(shown(), { heading: STORY_TYPES.espionage, cards: ['cap'] });
  type.props.onchange({ currentTarget: { value: '' } });
  assert.deepEqual(shown(), { heading: 'Popular places to start', cards: [STORY_TYPE_STARTERS[0], starter] });
});
