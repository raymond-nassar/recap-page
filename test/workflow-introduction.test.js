import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderAppDemo } from '../scripts/lib/pages-demo.mjs';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('../pages/index.html');
const readme = read('../README.md').split('## Made for long reading journeys')[0];
const packet = read('../docs/MICROSOFT_STORE_SUBMISSION.md');
const listing = packet.split('### Long description')[1].split('### Feature fields')[0];
const guide = JSON.parse(read('../src/data/civil_war_avengers.json'));
const orderGuide = JSON.parse(read('../src/data/ultimate_marvel_intro.json'));
const mcuGuide = JSON.parse(read('../src/data/mcu_prep_daredevil_born_again.json'));
const spiderGuide = JSON.parse(read('../src/data/spider_man_best_of.json'));
const avengersGuide = JSON.parse(read('../src/data/essential_avengers.json'));
const text = (source) => source.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const introductionSurfaces = [['project home', page], ['README', readme]];
const APP_STORE_LISTING = 'https://apps.apple.com/us/app/recap-page/id6828494712';
const PLAY_LISTING = 'https://play.google.com/store/apps/details?id=io.github.raymondnassar.recappage';

test('the README walkthrough shows a real cross-series transition with synthetic progress', () => {
  assert.equal(guide.items[6].title, 'Civil War (2006) #7');
  assert.equal(guide.items[7].title, 'New Avengers (2004) #21');
  assert.notEqual(guide.items[6].seriesId, guide.items[7].seriesId);

  const copy = text(readme);
  assert.ok(copy.includes(guide.name), 'README must name the specific guide');
  assert.ok(readme.includes(guide.source), 'README must link the actual guide credit');
  assert.match(copy, /Comic Book Herald/);
  assert.match(copy, /synthetic|made-up/);
  assert.match(copy, /first six comics/);
  assert.ok(copy.includes(guide.items[6].title), 'README must identify the next unread issue');
  assert.ok(copy.includes(guide.items[7].title), 'README must show the cross-series next issue');
  assert.match(copy, /choose \**Done\**\s*\./, 'README must name the Done button');
  assert.doesNotMatch(copy, /Done, next/, "README must use Done's own label");
  assert.match(copy, /resume/i);
});

test('the public page previews real reading-order and MCU Prep examples', async () => {
  const script = read('../pages/site.js');
  const demo = await renderAppDemo(fileURLToPath(new URL('..', import.meta.url)));
  const samples = JSON.parse(demo.match(/id="demo-samples">([\s\S]*?)<\/script>/)[1]);
  for (const [name, source] of [
    ['reading-orders', sectionFrom('reading-orders')],
    ['timeline', sectionFrom('timeline')],
    ['explore', sectionFrom('explore')],
    ['mcu-prep', sectionFrom('mcu-prep')],
  ]) {
    assert.match(source, /<details\b[\s\S]*?<summary\b/, `${name} needs a native interactive example`);
  }

  for (const [index, guideData] of [orderGuide, spiderGuide, avengersGuide].entries()) {
    assert.equal(samples[index].order.name, guideData.name);
    assert.equal(samples[index].order.source, guideData.source);
    assert.deepEqual(samples[index].order.items, guideData.items.slice(0, 3));
  }
  for (const issue of orderGuide.items.slice(0, 3)) {
    assert.ok(page.includes(issue.title), `page must show the real ordered issue ${issue.title}`);
  }
  assert.ok(page.includes(orderGuide.source), 'reading-order example must link its actual source');

  for (const issue of mcuGuide.items.slice(0, 3)) {
    assert.ok(page.includes(issue.title), `MCU Prep example must show the real issue ${issue.title}`);
  }
  assert.match(text(page), /project-selected Daredevil path/);
  assert.match(text(page), /offers character background, not a scene-by-scene guide/);
  assert.match(text(page), /Nothing is saved/);
  assert.match(script, /reset\.addEventListener\('click', loadDemo\)/);
  assert.doesNotMatch(script, /\b(?:localStorage|sessionStorage|fetch|XMLHttpRequest)\b/);
});

test('the project home and README distinguish shared progress and manual reading from access promises', () => {
  for (const [, source] of introductionSurfaces) {
    const copy = text(source);
    assert.match(copy, /Read markers are shared for the same issue across overlapping Reading Lists|An issue marked read stays read across lists|same issue stays marked read across lists/i);
    assert.match(copy, /each list keeps its own order/i);
    assert.match(copy, /(?:not|isn't) detected automatically|does not detect (?:it|your reading)/i);
    assert.match(copy, /same browser profile/);
    assert.match(copy, /December 7, 2026/);
    assert.match(copy, /general Marvel Comics website, not a single-comic link/);
    if (source === page) assert.match(copy, /desktop/);
    assert.match(copy, /Each installation saves separately|No automatic device sync/);
    assert.match(copy, /offline comic reading|(?:does not )?include offline comics/);
  }
  for (const source of [page, readme]) {
    const copy = text(source);
    const targets = new Set([
      ...source.matchAll(/\]\(([^)\s]+)\)/g),
      ...source.matchAll(/\bhref="([^"]*)"/g),
    ].map((match) => match[1]));
    assert.match(copy, /iPhone,? and iPad/);
    assert.doesNotMatch(copy, /App Store review/);
    assert.ok(
      targets.has(APP_STORE_LISTING),
      'must link the App Store listing',
    );
    assert.ok(
      targets.has(PLAY_LISTING),
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

test('the public page has usable static content and native examples without JavaScript', () => {
  assert.match(page, /<noscript>[\s\S]*?The guided controls need JavaScript/);
  assert.match(page, /Preview the first three comics in a real reading order/);
  assert.match(page, /Explore the first steps in this sample path/);
  assert.match(page, /<details\b[\s\S]*?<summary\b/);
  assert.match(page, /<script type="module" src="\.\/site\.js"><\/script>/);
  assert.doesNotMatch(page, /<form\b/);
  assert.match(page, /sandbox="allow-scripts"/);
  assert.doesNotMatch([page, readme, listing].join('\n'), /[\u2013\u2014]/);
});

function sectionFrom(id) {
  return page.match(new RegExp(`<section id="${id}"[\\s\\S]*?<\\/section>`))?.[0] ?? '';
}
