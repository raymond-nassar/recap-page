import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');

function aboutView() {
  const start = HTML.indexOf('<section id="view-about"');
  assert.notEqual(start, -1, 'the About view must remain in the page');
  const end = HTML.indexOf('<section id="view-reading-paths"', start);
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
