import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');

function aboutView() {
  const start = HTML.indexOf('<section id="view-about"');
  assert.notEqual(start, -1, 'the About view must remain in the page');
  const end = HTML.indexOf('<section id="view-completed"', start);
  assert.notEqual(end, -1, 'the About view must remain bounded by the next view');
  return HTML.slice(start, end);
}

function prose(markup) {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

test('the About view credits the exact Reading List guide sources', () => {
  const about = aboutView();
  const links = [...about.matchAll(
    /<a href="([^"]+)" target="_blank" rel="noopener noreferrer">([^<]+)<\/a>/g,
  )].map(([, href, name]) => ({ href, name }));

  assert.ok(links.some(({ href, name }) => (
    href === 'https://www.comicbookherald.com/' && name === 'Comic Book Herald'
  )));
  assert.ok(links.some(({ href, name }) => (
    href === 'https://comicbookreadingorders.com/' && name === 'Comic Book Reading Orders'
  )));

  const credit = prose(about);
  assert.match(
    credit,
    /Thank you to Comic Book Herald and Comic Book Reading Orders for the guides used to compile many bundled Reading Lists\./,
  );
  assert.match(
    credit,
    /Every externally guided list names and links to the exact source it follows\./,
  );
  assert.match(
    credit,
    /Reading Lists assembled in this project come from Marvel series metadata or are compiled by hand\./,
  );
});

test('the About view credits the links that open individual comics, right after the Reading List credits', () => {
  const about = aboutView();
  const headings = [...about.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map(([, name]) => name);
  assert.equal(headings[headings.indexOf('Reading List credits') + 1], 'Comic link credits');
  const section = about.slice(about.indexOf('>Comic link credits</h3>'), about.indexOf('<h3', about.indexOf('>Comic link credits</h3>')));
  assert.equal(
    prose(section).replace(/^> ?Comic link credits /, ''),
    'Thank you to werhsdnas of the Continuity Guide Discord server and Comic Book Reading Orders for the links that open individual comics in the Marvel Comics app.',
  );
});
