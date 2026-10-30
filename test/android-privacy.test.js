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
  assert.match(text, /no longer contacts Bifrost/);
  assert.match(text, /installed browser, not the Marvel Unlimited app/);
  assert.match(text, /general Marvel Comics website without a reader-link lookup/);
  assert.doesNotMatch(text, /sends a known digital issue ID to Marvel's Bifrost/);
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

// Cloud backup on Android (#810, P03-T03): the sentences the replacement writes come in the shared off and
// on variants, so a build with cloud backup does not say nothing is uploaded, and the card's privacy
// paragraph names this device rather than a Windows account.
test('Android About and the cloud card say what an Android build with cloud backup does', () => {
  const spans = [...yourData(generated).matchAll(/<span data-cloud-copy="(on|off)"(\s+hidden)?>([\s\S]*?)<\/span>/g)]
    .map(([, state, hidden, inner]) => [state, Boolean(hidden), prose(inner)]);
  const intro = spans.slice(0, 2);
  assert.deepEqual(intro, [
    ['off', false, 'There is no account to create and no analytics or tracking. The automatic service requests do not upload your saved lists, progress or notes.'],
    ['on', true, 'There is no Recap Page account to create, and no analytics or tracking. Your lists, progress and notes are uploaded only if you turn on cloud backup in Backup & settings, and then only to your own OneDrive, where they are as private as anything else you keep there. Recap Page\'s developer has no access to them.'],
  ]);
  assert.doesNotMatch(generated, /Windows account/);
  const card = generated.match(/<p class="rail-hint" id="cloud-backup-privacy">([\s\S]*?)<\/p>/);
  assert.ok(card, 'the cloud card keeps its privacy paragraph');
  assert.match(prose(card[1]), /Disconnecting stops cloud backup on this device; backups already in OneDrive stay until you delete them here or in OneDrive\.$/);
});

test('Android cloud help uses the exact approved device wording without changing Windows', () => {
  const pairs = [
    ['Your reading progress lives in this browser, at this exact address, and is sent only to your own OneDrive, if you turn on cloud backup below.', 'Your reading progress lives in this app on this device, and is sent only to your own OneDrive, if you turn on cloud backup below.'],
    ['Back up this browser automatically', 'Back up automatically'],
    ['A backup is made once changes have been quiet for ten seconds, at most once every five minutes, and at once when you leave Recap Page. The two newest backups of this browser are kept, and older ones go to OneDrive\'s recycle bin. Restoring one replaces everything it holds, as restoring a complete backup file does.', 'A backup is made once changes have been quiet for ten seconds, at most once every five minutes, and at once when you leave Recap Page. The two newest backups made on this device are kept, and older ones go to OneDrive\'s recycle bin. Restoring one replaces everything it holds, as restoring a complete backup file does.'],
    ['The choice is stored in this browser alongside your other settings and is sent only inside a cloud backup to your own OneDrive, if you turn cloud backup on. High contrast mode and reduced motion are still honoured whichever you pick.', 'The choice is stored on this device alongside your other settings and is sent only inside a cloud backup to your own OneDrive, if you turn cloud backup on. High contrast mode and reduced motion are still honoured whichever you pick.'],
    ['Cloud backup is the one exception, and only once you turn it on. After you sign in on Microsoft\'s own page, Recap Page sends a complete backup of what you save to your own OneDrive after you make changes. It also lists and reads the backups there, to check them and to offer them for restoring, and deletes this browser\'s older ones. Microsoft sees those backups, as it sees anything in your OneDrive.', 'Cloud backup is the one exception, and only once you turn it on. After you sign in on Microsoft\'s own page, Recap Page sends a complete backup of what you save to your own OneDrive after you make changes. It also lists and reads the backups there, to check them and to offer them for restoring, and deletes the older ones made on this device. Microsoft sees those backups, as it sees anything in your OneDrive.'],
  ];
  for (const [windows, android] of pairs) {
    assert.ok(prose(desktop).includes(windows), windows);
    assert.ok(prose(generated).includes(android), android);
    assert.ok(!prose(generated).includes(windows), windows);
  }
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
  assert.match(text, /policy does not establish how long recipients keep request data/i);
  assert.match(text, /no-store[^.]*not[^.]*deletion/i);
  assert.match(text, /uninstalling[^.]*does not remove browser-owned state/i);
});

test('Android privacy preparation preserves desktop HTML, shared behavior and fixed origin', async () => {
  assert.equal(await readFile(new URL('../src/index.html', import.meta.url), 'utf8'), desktop);
  assert.equal(config.origin, 'http://127.0.0.1:8787');
  assert.match(desktop, /<script type="module" src="\.\/js\/app\.js"><\/script>/);
  assert.doesNotMatch(desktop, /Privacy policy \(opens in your browser\)|private Android app storage/);
  const details = (html) => yourData(html).match(/<details\b[\s\S]*?<\/details>/)?.[0]
    ?.replace(/<span data-cloud-copy="on" hidden>[\s\S]*?<\/span>/, '');
  assert.ok(details(desktop));
  assert.equal(details(generated), details(desktop), 'Keep the request-by-request enumeration outside the approved cloud wording');
  for (const path of ['js/main.js', 'js/storage.js', 'js/reader.js', 'js/lib/model.js', 'js/lib/download.js', 'js/views/completion.js']) {
    assert.deepEqual(await readFile(join(scratch, 'assets', path)), await readFile(join('src', path)), path);
  }
  const [activity, nativePolicy] = await Promise.all([
    readFile(new URL('../packaging/android/app/src/main/java/io/github/raymondnassar/recappage/prototype/MainActivity.java', import.meta.url), 'utf8'),
    readFile(new URL('../packaging/android/app/src/main/java/io/github/raymondnassar/recappage/prototype/NavigationPolicy.java', import.meta.url), 'utf8'),
  ]);
  assert.match(activity, /SRC_ANCHOR_TYPE[\s\S]*?isHttps\(hit\.getExtra\(\)\)[\s\S]*?openExternal\(hit\.getExtra\(\)\)/);
  assert.match(nativePolicy, /boolean isHttps\(String value\)/);
});

test('generated Android shares the approved private list-reporting instructions and protected responder link', () => {
  const feedbackUrl = 'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=DQSIkWdsW0yxEjajBLZtrQAAAAAAAAAAAAMAAEys2uVUMkJLVFlNTUhaUFk0NERQQzYxT0xSSDAwVy4u';
  const feedback = (html) => html.match(/<dialog\b[^>]*id="list-feedback"[^>]*>[\s\S]*?<\/dialog>/)?.[0];
  assert.ok(feedback(desktop));
  assert.equal(feedback(generated), feedback(desktop));
  const link = feedback(generated).match(/<a\b[^>]*id="list-feedback-link"[^>]*>/)?.[0];
  assert.ok(link?.includes(`href="${feedbackUrl}"`), 'generated Android must use the same approved responder');
  assert.match(link, /target="_blank"/);
  assert.match(link, /rel="noopener noreferrer"/);
  assert.match(link, /referrerpolicy="no-referrer"/);
  assert.match(prose(feedback(generated)), /No account, name or email required/);
  assert.match(prose(feedback(generated)), /saved reading data and thumb choice are not attached/);
  assert.doesNotMatch(feedback(generated), /GitHub requires|issues are public|<iframe|<script|<form\b/);
});
