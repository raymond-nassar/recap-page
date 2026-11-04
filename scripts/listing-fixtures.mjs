import { CLOUD_HOST_PREFIX } from '../src/js/lib/cloudHostTransport.js';

// A tooling-only configuration, not a Microsoft application or a credential. No host is started:
// the capture answers only status, so it cannot sign in, read an account or upload a backup.
export const CLOUD_FIXTURE = Object.freeze({
  format: 'recap-page-cloud-client', version: 1,
  providers: { onedrive: { clientId: 'screenshot-fixture.recap-page', authority: 'consumers' } },
});
const CLOUD_STATUS = Object.freeze({
  provider: Object.keys(CLOUD_FIXTURE.providers)[0], state: 'not-connected',
  connection: null, account: null, message: null, reason: null, signInExpiresAt: null,
});

export function cloudFixtureResponse(url, method) {
  if (!new URL(url).pathname.startsWith(CLOUD_HOST_PREFIX)) return null;
  if (method !== 'POST' || new URL(url).pathname !== `${CLOUD_HOST_PREFIX}status`) {
    throw new Error('Screenshot fixtures permit cloud status only');
  }
  return {
    status: 200, contentType: 'application/json', fixture: 'cloud-status',
    body: JSON.stringify({ ok: true, status: CLOUD_STATUS }),
  };
}

export async function installCloudFixture(page) {
  await page.evaluateOnNewDocument((status) => {
    // The generated Android entry uses its real message-port transport. This port stands in for
    // MainActivity, not a native device. Desktop uses the intercepted HTTP status response instead.
    window.addEventListener('load', () => {
      if (!document.querySelector('script[src="./android/app.js"]')) return;
      const channel = new MessageChannel();
      channel.port1.onmessage = ({ data }) => {
        const message = JSON.parse(data);
        if (message.kind !== 'cloud' || message.op !== 'status') {
          window.__playPreviewViolations.push('non-status Android bridge operation requested');
          return;
        }
        channel.port1.postMessage(JSON.stringify({
          v: 1, kind: 'cloud-result', id: message.id, status: 200,
          body: { ok: true, status },
        }));
      };
      window.dispatchEvent(new MessageEvent('message', {
        data: 'recap:connect:v1', origin: '', source: null, ports: [channel.port2],
      }));
    }, { once: true });
  }, CLOUD_STATUS);
}

// The text a capture's frame shows, for the audits' expected phrases. Both audits once read the whole
// page's text, so a frame that missed its subject still passed: the phone reading image framed the
// card while its progress sat below it, and only looking at the image showed it. Runs in the page, so
// it is self-contained. Text counts when it is rendered, not inside a closed disclosure's body,
// inside the viewport and not covered there, such as by the phone's bottom navigation.
export function framedText() {
  const width = document.documentElement.clientWidth;
  const height = innerHeight;
  const parts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!node.textContent.trim() || !parent || parent.closest('[hidden], script, style, template')) continue;
    const style = getComputedStyle(parent);
    if (style.visibility !== 'visible' || Number(style.opacity) === 0) continue;
    let transparent = false;
    for (let ancestor = parent.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (Number(getComputedStyle(ancestor).opacity) === 0) { transparent = true; break; }
    }
    if (transparent) continue;
    const closed = parent.closest('details:not([open])');
    if (closed && !closed.querySelector(':scope > summary')?.contains(parent)) continue;
    let text = '', offset = 0;
    // A paragraph can cross the viewport edge. One visible line must not approve its hidden lines.
    for (const character of node.textContent) {
      range.setStart(node, offset);
      offset += character.length;
      range.setEnd(node, offset);
      const rectangles = [...range.getClientRects()];
      const seen = rectangles.length > 0 && rectangles.every((rect) => {
        if (rect.left < 0 || rect.right > width || rect.top < 0 || rect.bottom > height) return false;
        const hit = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
        return Boolean(hit && (parent.contains(hit) || hit.contains(parent)));
      });
      text += seen || /\s/.test(character) ? character : '\uFFFC';
    }
    if (style.textTransform === 'uppercase') text = text.toUpperCase();
    parts.push(text);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export async function prepareCloudView(page, view) {
  if (view !== 'view-about' && view !== 'view-data') return;
  await page.waitForFunction((id) => {
    const nodes = [...document.querySelectorAll(`#${id} [data-cloud-copy="on"]`)];
    return nodes.length > 0 && nodes.every((node) => !node.hidden)
      && [...document.querySelectorAll(`#${id} [data-cloud-copy="off"]`)].every((node) => node.hidden);
  }, { timeout: 15000 }, view);
  if (view === 'view-data') {
    await page.waitForSelector('#cloud-backup:not([hidden])', { timeout: 15000 });
    await page.evaluate(() => { document.querySelector('#cloud-backup details.setting-more:last-child').open = true; });
  }
}

export async function dismissListingNotice(page, enabled) {
  if (!enabled) return;
  await page.waitForSelector('#reader-closure-dismiss', { visible: true, timeout: 15000 });
  await page.$eval('#reader-closure-dismiss', (button) => button.click());
  await page.waitForSelector('#reader-closure-notice', { hidden: true, timeout: 15000 });
}
