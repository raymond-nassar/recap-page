import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareAndroid } from '../scripts/prepare-android.mjs';

const policyUrl = 'https://github.com/raymond-nassar/recap-page/blob/main/PRIVACY.md';
let scratch;
let generated;
let desktop;
let config;

function yourData(html) {
  const match = html.match(/<h3>Your data<\/h3>([\s\S]*?)<h3>This build<\/h3>/);
  assert.ok(match, 'About must retain its Your data section');
  return match[1];
}

function prose(text) {
  return text.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'recap-android-privacy-'));
  desktop = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
  ({ config } = await prepareAndroid(join(scratch, 'assets')));
  generated = await readFile(join(scratch, 'assets', 'index.html'), 'utf8');
});

after(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

test('Android About distinguishes automatic requests, explicit export and private app storage', () => {
  const text = prose(yourData(generated));
  assert.match(text, /private Android app storage/i);
  assert.match(text, /separate from your desktop browser/i);
  assert.match(text, /no account/i);
  assert.match(text, /no analytics or tracking/i);
  assert.match(text, /automatic service requests do not upload your saved lists, progress or notes/i);
  assert.match(text, /export[^.]*gives[^.]*selected document provider[^.]*progress and notes/i);
  assert.match(text, /import and export request a local-only provider/i);
  assert.match(text, /not a guarantee[^.]*sync[^.]*retention/i);
  assert.match(text, /clearing app data or uninstalling[^.]*removes/i);
  assert.match(text, /keep a backup outside the app/i);
  assert.doesNotMatch(text, /progress and your notes are never sent anywhere/i);
  assert.match(text, /digital issue ID to Marvel's Bifrost service/);
  assert.match(text, /Open in browser/);
  assert.match(text, /Searching for issues sends what you typed/);
  assert.match(text, /series or creators is answered from files already on this machine/);
  assert.match(text, /only when you press the lookup button/);
  const links = [...yourData(generated).matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  assert.equal(links.length, 1, 'The added disclosure has one explicit policy destination');
  assert.equal(links[0][1], policyUrl);
  assert.match(links[0][0], /target="_blank"/);
  assert.match(links[0][0], /rel="noopener noreferrer"/);
  assert.match(links[0][0], /referrerpolicy="no-referrer"/);
  assert.equal(prose(links[0][2]), 'Privacy policy (opens in your browser)');
  assert.doesNotMatch(links[0][0], /onclick=|data-view=/);
});

test('public privacy policy names the actual platform, search, provider and erase boundaries', async () => {
  const text = prose(await readFile(new URL('../PRIVACY.md', import.meta.url), 'utf8'));
  assert.match(text, /Android[^.]*private WebView storage/i);
  assert.match(text, /not a listening server/i);
  assert.match(text, /does not use the desktop service-worker shell/i);
  assert.match(text, /series and creator name searches[^.]*bundled[^.]*locally/i);
  assert.match(text, /selected series or creator[^.]*IDs/i);
  assert.match(text, /local-only[^.]*not a guarantee[^.]*sync[^.]*retention/i);
  assert.match(text, /settings and sidebar preferences remain/i);
  assert.match(text, /salvage copies[^.]*not removed/i);
  assert.match(text, /pre-restore and staging copies[^.]*attempted/i);
  assert.match(text, /previously exported files/i);
  assert.match(text, /recipient retention[^.]*not established/i);
  assert.match(text, /no-store[^.]*not[^.]*deletion/i);
  assert.match(text, /uninstalling[^.]*does not remove browser-owned state/i);
});

test('Android privacy preparation preserves desktop HTML, shared behavior and fixed origin', async () => {
  assert.equal(await readFile(new URL('../src/index.html', import.meta.url), 'utf8'), desktop);
  assert.equal(config.origin, 'http://127.0.0.1:8787');
  assert.match(desktop, /<script type="module" src="\.\/js\/app\.js"><\/script>/);
  assert.doesNotMatch(desktop, /Privacy policy \(opens in your browser\)|private Android app storage/);
  const details = (html) => yourData(html).match(/<details\b[\s\S]*?<\/details>/)?.[0];
  assert.ok(details(desktop));
  assert.equal(details(generated), details(desktop), 'Keep the existing request-by-request enumeration');
  for (const path of ['js/main.js', 'js/storage.js', 'js/reader.js', 'js/lib/model.js', 'js/lib/download.js']) {
    assert.deepEqual(await readFile(join(scratch, 'assets', path)), await readFile(join('src', path)), path);
  }
  const [activity, nativePolicy] = await Promise.all([
    readFile(new URL('../packaging/android/app/src/main/java/io/github/raymondnassar/recappage/prototype/MainActivity.java', import.meta.url), 'utf8'),
    readFile(new URL('../packaging/android/app/src/main/java/io/github/raymondnassar/recappage/prototype/NavigationPolicy.java', import.meta.url), 'utf8'),
  ]);
  assert.match(activity, /SRC_ANCHOR_TYPE[\s\S]*?isHttps\(hit\.getExtra\(\)\)[\s\S]*?openExternal\(hit\.getExtra\(\)\)/);
  assert.match(nativePolicy, /boolean isHttps\(String value\)/);
});
