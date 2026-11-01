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
const introductionSurfaces = [['project home', page], ['README', readme]];

test('the introduction walks through a real cross-series transition with synthetic progress', () => {
  assert.equal(guide.items[6].title, 'Civil War (2006) #7');
  assert.equal(guide.items[7].title, 'New Avengers (2004) #21');
  assert.notEqual(guide.items[6].seriesId, guide.items[7].seriesId);

  for (const [name, source] of introductionSurfaces) {
    const copy = text(source);
    assert.ok(copy.includes(guide.name), `${name} must name the specific guide`);
    assert.ok(source.includes(guide.source), `${name} must link the actual guide credit`);
    assert.match(copy, /Comic Book Herald/);
    assert.match(copy, /synthetic|made-up/);
    assert.match(copy, /first six comics/);
    assert.ok(copy.includes(guide.items[6].title), `${name} must identify the next unread issue`);
    assert.ok(copy.includes(guide.items[7].title), `${name} must show the cross-series next issue`);
    assert.match(copy, /choose \**Done\**\s*\./, `${name} must name the Done button`);
    assert.doesNotMatch(copy, /Done, next/, `${name} must use Done's own label`);
    assert.match(copy, /resume/i);
  }
});

test('the project home and README distinguish shared progress and manual reading from access promises', () => {
  for (const [, source] of introductionSurfaces) {
    const copy = text(source);
    assert.match(copy, /Read markers are shared for the same issue across overlapping Reading Lists|An issue marked read stays read across lists/);
    assert.match(copy, /each list keeps its own order/i);
    assert.match(copy, /(?:not|isn't) detected automatically/);
    assert.match(copy, /same browser profile/);
    assert.match(copy, /December 7, 2026/);
    assert.match(copy, /general Marvel Comics website, not a single-comic link/);
    if (source === page) assert.match(copy, /desktop/);
    assert.match(copy, /No automatic device sync or offline comic reading/);
  }
  for (const source of [page, readme]) {
    const copy = text(source);
    assert.match(copy, /In App Store review for iPhone and iPad/);
    assert.ok(
      source.includes('https://play.google.com/store/apps/details?id=io.github.raymondnassar.recappage'),
      'must link the Google Play listing',
    );
    assert.doesNotMatch(copy, /Not available on Google Play|earlier beta|Try the beta/);
    assert.doesNotMatch(copy, /not a native phone app/);
  }
});

test('the shorter approved Store listing explains the benefit and reading limits', () => {
  const copy = text(listing);
  assert.match(copy, /Follow any Marvel story across series and pick up at your next unread comic/);
  assert.match(copy, /OneDrive is optional and off until you choose it/);
  assert.match(copy, /Comics are not included/);
  assert.match(copy, /Reading in Marvel Unlimited ends December 7, 2026/);
  assert.match(copy, /Read opens the Marvel Comics website/);
  assert.match(copy, /Comic Book Herald and Comic Book Reading Orders/);
  assert.match(copy, /unofficial fan companion/);
});

test('the public walkthrough remains an ordered no-script text explanation with covers-off samples', () => {
  const walkthrough = page.match(/<ol class="walkthrough">([\s\S]*?)<\/ol>/)?.[1];
  assert.ok(walkthrough, 'the walkthrough must be a semantic ordered list');
  assert.equal((walkthrough.match(/<li>/g) ?? []).length, 5);
  assert.doesNotMatch(walkthrough, /<(?:img|video|iframe|script|button|input)\b/);
  assert.match(page, /Desktop views with cover art off/);
  assert.doesNotMatch(page, /<(?:script|form|iframe)\b/);
  assert.doesNotMatch([page, readme, listing].join('\n'), /[\u2013\u2014]/);
});
