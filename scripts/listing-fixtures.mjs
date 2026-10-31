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
