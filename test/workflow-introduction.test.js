import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('../pages/index.html');
const readme = read('../README.md').split('## Made for long reading journeys')[0];
const packet = read('../docs/MICROSOFT_STORE_SUBMISSION.md');
const listing = packet.split('### Long description')[1].split('### Feature fields')[0];
const guide = JSON.parse(read('../src/data/civil_war_avengers.json'));
const text = (source) => source.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('the introduction walks through a real cross-series transition with synthetic progress', () => {
  assert.equal(guide.items[6].title, 'Civil War (2006) #7');
  assert.equal(guide.items[7].title, 'New Avengers (2004) #21');
  assert.notEqual(guide.items[6].seriesId, guide.items[7].seriesId);

  for (const [name, source] of [['project home', page], ['README', readme], ['Store listing', listing]]) {
    const copy = text(source);
    assert.ok(copy.includes(guide.name), `${name} must name the specific guide`);
    assert.ok(source.includes(guide.source), `${name} must link the actual guide credit`);
    assert.match(copy, /Comic Book Herald/);
    assert.match(copy, /synthetic|made-up/);
    assert.match(copy, /first six comics/);
    assert.ok(copy.includes(guide.items[6].title), `${name} must identify the next unread issue`);
    assert.ok(copy.includes(guide.items[7].title), `${name} must show the cross-series next issue`);
    assert.match(copy, /Done, next/);
    assert.match(copy, /resume/i);
  }
});

test('all introduction surfaces distinguish shared progress and manual reading from access promises', () => {
  for (const source of [page, readme, listing]) {
    const copy = text(source);
    assert.match(copy, /Read markers are shared for the same issue across overlapping Reading Lists/);
    assert.match(copy, /each list keeps its own order/);
    assert.match(copy, /not detected automatically/);
    assert.match(copy, /same browser profile/);
    assert.match(copy, /separate tab/);
    assert.match(copy, /official issue page/);
    assert.match(copy, /not guaranteed access/);
    assert.match(copy, /subscription/);
    assert.match(copy, /desktop/);
    assert.match(copy, /not a native phone app/);
    assert.match(copy, /No automatic device sync or offline comic reading/);
  }
});

test('the public walkthrough remains an ordered no-script text explanation with covers-off samples', () => {
  const walkthrough = page.match(/<ol class="walkthrough">([\s\S]*?)<\/ol>/)?.[1];
  assert.ok(walkthrough, 'the walkthrough must be a semantic ordered list');
  assert.equal((walkthrough.match(/<li>/g) ?? []).length, 5);
  assert.doesNotMatch(walkthrough, /<(?:img|video|iframe|script|button|input)\b/);
  assert.match(page, /Sample views below, with cover art off/);
  assert.doesNotMatch(page, /<(?:script|form|iframe)\b/);
  assert.doesNotMatch([page, readme, listing].join('\n'), /[\u2013\u2014]/);
});
