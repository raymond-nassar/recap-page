import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../src/dev-faults.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/dev-faults.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../src/dev-faults.js', import.meta.url), 'utf8');

test('every fault action result is a uniquely named atomic status', () => {
  const outputs = [...html.matchAll(/<div class="out"[^>]+>/g)].map(([tag]) => tag);
  assert.equal(outputs.length, 5);
  assert.ok(outputs.every((tag) => /role="status"/.test(tag)));
  assert.ok(outputs.every((tag) => /aria-live="polite"/.test(tag)));
  assert.ok(outputs.every((tag) => /aria-atomic="true"/.test(tag)));

  const names = outputs.map((tag) => tag.match(/aria-label="([^"]+)"/)?.[1]);
  assert.ok(names.every(Boolean));
  assert.equal(new Set(names).size, outputs.length);
});

test('result urgency is selected before the complete message is replaced', () => {
  const role = js.indexOf("el.setAttribute('role', failed ? 'alert' : 'status');");
  const live = js.indexOf("el.setAttribute('aria-live', failed ? 'assertive' : 'polite');");
  const message = js.indexOf('el.textContent = msg;');
  assert.ok(role >= 0 && live > role && message > live);
  assert.match(
    js,
    /say\('out-3b', 'Your current state is not readable,[^;]+', 'bad'\);/,
  );
});

test('reduced motion prevents the result animation from being created', () => {
  const preference = js.indexOf("matchMedia('(prefers-reduced-motion: reduce)').matches");
  const animation = js.indexOf('el.animate(');
  assert.ok(preference >= 0 && animation > preference);
});

test('buttons and links share an explicit focus-visible indicator', () => {
  assert.match(
    css,
    /button:focus-visible, a:focus-visible \{ outline: 3px solid currentColor; outline-offset: 2px; \}/,
  );
});

test('the harness names the one origin that shares tracker storage', () => {
  assert.match(html, /http:\/\/127\.0\.0\.1:8787/);
  assert.match(html, /Changing the host or port selects a different browser storage bucket\./);
});

test('destructive writes remain behind their refusal points', () => {
  assert.equal((js.match(/if \(!guard\(\)\) return;/g) ?? []).length, 2);
  const wipeGuard = js.indexOf("if (!confirm('Remove ALL tracker data on this origin");
  const firstRemoval = js.indexOf('localStorage.removeItem(k); removed += 1;', wipeGuard);
  assert.ok(wipeGuard >= 0 && firstRemoval > wipeGuard);
});
