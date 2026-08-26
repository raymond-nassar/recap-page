import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COVER_IMAGE_HOST, isAllowedCoverUrl } from '../src/js/lib/coverHost.js';
import { normalizeCover, normalizeIssue, coverUrl } from '../src/js/lib/model.js';
import { catalogCoverUrl } from '../src/js/lib/catalog.js';

// Covers are the one thing this app asks a third party for on every render, and until this was
// written both the URL policy and the image policy accepted any https origin at all. A metadata
// service that was compromised, or simply one the reader had pointed the app at themselves, could
// therefore return a cover address on a host of its choosing and the browser would fetch it for
// every issue on screen, disclosing the reader's address and what they are reading to a party the
// interface never mentioned. The interface meanwhile said covers came from Marvel's own servers.
//
// These hold the two halves to the one host, and hold the claim in the markup to the same thing.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const ok = (path) => `https://${COVER_IMAGE_HOST}${path}`;

test('a cover on the pinned host is accepted, and http is still upgraded to it', () => {
  assert.equal(isAllowedCoverUrl(ok('/u/prod/marvel/i/mg/6/60/abcdef0123456')), true);
  const issue = normalizeIssue({ issueId: 1, title: 'T', cover: { path: `http://${COVER_IMAGE_HOST}/u/x`, extension: 'jpg' } });
  assert.equal(issue.cover.path, ok('/u/x'), 'the http the API reports must still be upgraded, not refused');
});

test('a cover offered from any other https host is refused', () => {
  assert.equal(isAllowedCoverUrl('https://tracker.example/pixel'), false);
  assert.equal(normalizeCover({ path: 'https://tracker.example/pixel', extension: 'jpg' }), null);
});

// The four ways a host check written on the string rather than on the parsed URL gets past. Each
// of these contains the pinned host as text and is a different endpoint, so a check using
// startsWith, endsWith, includes or a bare regexp would admit at least one of them.
test('a host that merely contains the pinned host as text is refused', () => {
  for (const path of [
    `https://${COVER_IMAGE_HOST}.tracker.example/pixel`,
    `https://tracker.example/${COVER_IMAGE_HOST}/pixel`,
    `https://not-${COVER_IMAGE_HOST}/pixel`,
    `https://tracker.example/?x=https://${COVER_IMAGE_HOST}/u/x`,
  ]) {
    assert.equal(isAllowedCoverUrl(path), false, `${path} must not be treated as the CDN`);
    assert.equal(normalizeCover({ path, extension: 'jpg' }), null, `${path} must not become a cover`);
  }
});

// Credentials and a port both change which endpoint is contacted while leaving the host text in
// place, and the second matters for the directive too: a source expression naming no port permits
// only the default one, so admitting a port here would allow a URL the browser then blocks.
//
// Plain http on the right host is the same disagreement in the other direction. The directive
// names an https origin, so an http cover address would be refused by the browser after the
// policy had allowed it, and the reader would see a missing image with nothing to explain it.
// normalizeCover upgrades the http the API reports before asking, which is why this can be strict
// without refusing real data, and the upgrade is held by the test above.
test('a port, an embedded credential or plain http does not make a host the CDN', () => {
  assert.equal(isAllowedCoverUrl(`https://${COVER_IMAGE_HOST}:8080/u/x`), false);
  assert.equal(isAllowedCoverUrl(`https://${COVER_IMAGE_HOST}@tracker.example/pixel`), false);
  assert.equal(isAllowedCoverUrl(`http://${COVER_IMAGE_HOST}/u/x`), false);
});

// The pin walked through rather than around. The check reads a parsed copy of the address, so
// whatever it stores has to be that parse serialized: a path carrying a double quote really is on
// the pinned host and is accepted, and if the sender's string were kept the quote would close the
// url("...") the hero background is built as, letting a second layer naming any host follow it
// inside the same declaration. Held at the chokepoint, measured at the sink.
test('a quote in a cover path cannot open a second layer in the hero background', () => {
  const hostile = { path: `https://${COVER_IMAGE_HOST}/u/x"),url("https://tracker.example/p`, extension: 'jpg' };
  const url = coverUrl(normalizeIssue({ issueId: 1, title: 'T', cover: hostile }), 'detail');
  assert.ok(url, 'the address is on the pinned host, so it is accepted rather than refused');
  assert.ok(!url.includes('"'), `a quote survived into the built URL: ${url}`);
  assert.equal(new URL(url).host, COVER_IMAGE_HOST, 'the built URL must still resolve to the CDN');

  // The declaration exactly as renderHero builds it, whose shape is pinned by the census below.
  // Layers are counted by the string delimiters rather than by occurrences of `url(`: the encoded
  // path still reads `url(` as text, harmlessly, because it sits inside the one quoted string. Two
  // quotes means that string is opened once and closed once, which is what one layer is.
  const declaration = `url("${url}")`;
  assert.equal((declaration.match(/"/g) ?? []).length, 2, `${declaration} closes its string early, so it paints more than one layer`);
  assert.equal(new URL(declaration.slice(5, -2)).host, COVER_IMAGE_HOST, 'the one layer must name the CDN');
});

// The point of refusing at normalizeCover rather than at the point of painting: no URL is ever
// built, so there is nothing for a caller to request even if it ignores the setting entirely.
test('a hostile cover yields no URL for any builder to request', () => {
  const hostile = { path: 'https://tracker.example/pixel', extension: 'jpg' };
  assert.equal(coverUrl(normalizeIssue({ issueId: 1, title: 'T', cover: hostile })), null);
  assert.equal(catalogCoverUrl({ id: 'x', cover: hostile }), null);
});

// A restored backup goes through the same normalizer, so a file edited to carry a hostile cover
// cannot reintroduce one. This is the path the address would persist on if it did not.
test('a hostile cover cannot ride in on a restored backup', () => {
  const issue = normalizeIssue({ issueId: 52447, title: 'T', cover: { path: 'https://tracker.example/pixel', extension: 'jpg' } });
  assert.equal(issue.cover, null, 'the address is dropped rather than stored unusable');
});

// The inventory the pin was chosen from, walked once and read by the two tests below. Every
// bundled order is scanned rather than a sample, because the claim each makes is about all of them.
function scanBundledCovers() {
  const dir = join(ROOT, 'src/data');
  const hosts = new Map();
  const reserialized = [];
  let covers = 0;
  const scan = (node, file) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((n) => scan(n, file)); return; }
    if (node.cover && typeof node.cover === 'object' && typeof node.cover.path === 'string') {
      covers += 1;
      const upgraded = node.cover.path.replace(/^http:/, 'https:');
      let host;
      try { host = new URL(upgraded).host; } catch { host = `unparseable in ${file}`; }
      hosts.set(host, (hosts.get(host) ?? 0) + 1);
      const stored = normalizeCover(node.cover)?.path;
      if (stored !== upgraded) reserialized.push({ file, upgraded, stored });
    }
    for (const k of Object.keys(node)) scan(node[k], file);
  };
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    scan(JSON.parse(readFileSync(join(dir, f), 'utf8')), f);
  }
  return { covers, hosts, reserialized };
}

// If a future vendoring run introduces a host that is not the pinned one, every cover in that
// order would silently become a typographic tile; this fails instead, and names the file, so the
// pin is revisited deliberately rather than discovered later.
test('every cover in the bundled reading orders is on the pinned host', () => {
  const { covers, hosts } = scanBundledCovers();
  assert.ok(covers > 0, 'the bundled orders must still carry covers for this to measure anything');
  assert.deepEqual([...hosts.keys()], [COVER_IMAGE_HOST], `bundled covers name ${[...hosts.keys()].join(', ')}`);
});

// What is stored is the parsed address serialized again rather than the string the file carries,
// which is what keeps the check and the stored value the same string. That rewrite is only ever
// visible on an address that was not already in normal form, and nothing shipped is: every bundled
// cover serializes to itself. This says so if a vendoring run ever introduces one that does not,
// since a stored path quietly differing from its source file is worth knowing about.
test('serializing the address changes no cover that ships', () => {
  const { covers, reserialized } = scanBundledCovers();
  assert.ok(covers > 0, 'the bundled orders must still carry covers for this to measure anything');
  assert.deepEqual(reserialized, [], 'a bundled cover path is stored differently from how it is written');
});

// The half of the pin the browser enforces. server.mjs imports the constant, so the two cannot
// disagree by construction, and this holds the shape that makes the import worth having: no bare
// https: source, which would readmit every host the policy has just refused.
test('the image directive names the pinned host and no longer admits every https origin', () => {
  const src = read('server.mjs');
  const directive = /"?`?img-src ([^"`]+)`?"?,/.exec(src);
  assert.ok(directive, 'server.mjs must still carry an img-src directive');
  const sources = directive[1].trim().split(/\s+/);
  assert.deepEqual(sources, ["'self'", 'https://${COVER_IMAGE_HOST}', 'data:']);
  assert.ok(!sources.includes('https:'), 'a bare https: source would permit every host the URL policy refuses');
  assert.match(src, /import \{ COVER_IMAGE_HOST \} from '\.\/src\/js\/lib\/coverHost\.js'/,
    'the directive must be built from the module rather than repeating the host');
});

// connect-src has to stay wide, and it is the reason img-src was wide too. Losing that distinction
// is how this defect was introduced, so the difference is asserted rather than left to a comment.
test('the connect directive stays wide, because the API base really is user-configurable', () => {
  assert.match(read('server.mjs'), /"connect-src 'self' https: http:\/\/127\.0\.0\.1:\* http:\/\/localhost:\*"/);
});

// Every network image the app draws is built by one of the two vetted builders, both of which go
// through normalizeCover. A new assignment site added beside them would bypass the pin entirely
// while every test above still passed, so the assignment sites themselves are counted, and so are
// the arguments reaching the one helper that owns them.
//
// Comment lines are dropped first. The comment above the assignment quotes `img.src = url` in
// backticks to say what the line below it does, and a matcher reading the file raw counts that
// prose as a second assignment site.
test('nothing paints a cover except from a vetted builder', () => {
  const main = read('src/js/main.js')
    .split(/\r?\n/)
    .filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l))
    .join('\n');

  const assignments = [...main.matchAll(/\b\w+\.(?:src|backgroundImage)\s*=\s*([^;\n]+)/g)].map((m) => m[1].trim());
  assert.deepEqual(assignments.sort(), [
    'url',
    'url ? `url("${url}")` : \'none\'',
  ], 'an image source is assigned somewhere new; it must come from coverUrl or catalogCoverUrl');
  assert.match(main,
    /function paintHeroBackground\(target, issue\) \{\s+const url = settings\.covers \? coverUrl\(issue, 'detail'\) : null;/,
    'the shared hero background must receive its URL from the vetted issue-cover builder');

  // The same assignment reached through the DOM API rather than the property.
  assert.ok(!/setAttribute\(\s*['"`]src['"`]/.test(main), 'a src set through setAttribute would bypass the assignment check above');

  // `url` above is paintCoverUrl's parameter, so the pin only holds if its callers are vetted too.
  // The declaration is excluded, since its parameter list names that same parameter.
  const passed = [...main.matchAll(/(?<!function )paintCoverUrl\([^,]+,[^,]+,\s*([^,]+),/g)].map((m) => m[1].trim());
  assert.ok(passed.length >= 2, 'the view must still paint covers for this to measure anything');
  for (const arg of passed) {
    assert.match(arg, /^(?:null|coverUrl\(|catalogCoverUrl\()/, `a cover URL reaches the painter as ${arg}, which does not go through normalizeCover`);
  }
});
