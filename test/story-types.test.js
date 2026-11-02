import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HOME_CATEGORIES, STORY_TONES, STORY_TYPES, STORY_TYPES_ROUTE, availableHomeCategories,
  catalogEntries, storyTypeFacets, storyTypeStories,
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

test('the Story types card counts every tagged list outside MCU Prep', () => {
  const category = availableHomeCategories(fixture(), HOME_CATEGORIES)
    .find(({ key }) => key === STORY_TYPES_ROUTE);
  assert.equal(category.count, 3);
});

test('the view keeps only known choices and links every pill to its own address', () => {
  const el = (tag, props = {}, children = []) => ({
    tag, props, children: [children].flat(),
    replaceChildren(...next) { this.children = next; },
    append(...next) { this.children.push(...next); },
    querySelector: () => null,
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
  view.set({ storyType: 'espionage', tone: 'grim' });
  assert.deepEqual(view.selection(), { storyType: 'espionage', tone: null });
  view.render({ lists: fixture().map((story) => story.lists[0]) });
  assert.equal(count.textContent, '2 of 3 Reading Lists');
  const links = view.controls().children
    .flatMap((group) => group.children[1].children.map((item) => item.children[0].props));
  const current = links.filter((props) => props['aria-current']).map((props) => props.href);
  assert.deepEqual(current, ['#/story-types?type=espionage', '#/story-types?type=espionage']);
  assert.ok(links.every((props) => props.href.startsWith('#/story-types')));
});
