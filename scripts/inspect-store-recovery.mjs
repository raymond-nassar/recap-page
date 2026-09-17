import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { appendFileSync } from 'node:fs';

const PRODUCT = '9PDJ7XR9Q40Q';
const API = `https://manage.devcenter.microsoft.com/v1.0/my/applications/${PRODUCT}`;

function demand(condition, message) {
  if (!condition) throw new Error(message);
}

function identifier(value) {
  demand(typeof value === 'string' && /^[1-9]\d{1,30}$/.test(value), 'Invalid submission identity');
  return value;
}

export function fingerprint(value) {
  function ordered(item) {
    if (Array.isArray(item)) return item.map(ordered);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, ordered(item[key])]));
    }
    return item;
  }
  const content = structuredClone(value);
  delete content.fileUploadUrl;
  delete content.statusDetails;
  return createHash('sha256').update(JSON.stringify(ordered(content))).digest('hex');
}

function summary(submission, expectedId) {
  demand(submission?.id === expectedId, 'Submission identity differs');
  demand(typeof submission.status === 'string' && /^[A-Za-z]{1,60}$/.test(submission.status),
    'Invalid submission status');
  demand(Array.isArray(submission.applicationPackages) && submission.applicationPackages.length > 0,
    'Missing application packages');
  const packages = submission.applicationPackages.map((entry) => {
    demand(typeof entry.version === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(entry.version),
      'Invalid package version');
    demand(typeof entry.fileStatus === 'string' && /^[A-Za-z]{1,60}$/.test(entry.fileStatus),
      'Invalid package status');
    return { version: entry.version, status: entry.fileStatus };
  });
  demand(['Immediate', 'Manual', 'SpecificDate'].includes(submission.targetPublishMode),
    'Invalid publication mode');
  demand(typeof submission.packageDeliveryOptions?.packageRollout?.isPackageRollout === 'boolean',
    'Invalid rollout mode');
  return {
    id: expectedId, status: submission.status, packages,
    targetPublishMode: submission.targetPublishMode,
    gradualRollout: submission.packageDeliveryOptions.packageRollout.isPackageRollout,
    fingerprint: fingerprint(submission),
  };
}

export function uploadMetadata(value) {
  const url = new URL(value);
  demand(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname) && url.hostname.length <= 253,
    'Invalid upload hostname');
  const expiry = Date.parse(url.searchParams.get('se'));
  return {
    hostname: url.hostname,
    https: url.protocol === 'https:',
    ingestionPath: url.pathname.startsWith('/ingestion/'),
    hasCredentials: Boolean(url.username || url.password),
    hasFragment: Boolean(url.hash),
    hasSignature: url.searchParams.has('sig'),
    expiresAt: Number.isFinite(expiry) ? new Date(expiry).toISOString() : null,
  };
}

export async function inspect(request) {
  const application = await request(API);
  demand(application?.id === PRODUCT, 'Application identity differs');
  const publishedId = identifier(application.lastPublishedApplicationSubmission?.id);
  const pendingId = application.pendingApplicationSubmission == null
    ? null : identifier(application.pendingApplicationSubmission.id);
  const published = await request(`${API}/submissions/${publishedId}`);
  const pending = pendingId === null ? null : await request(`${API}/submissions/${pendingId}`);
  return {
    productId: PRODUCT,
    published: summary(published, publishedId),
    pending: pending === null ? null : summary(pending, pendingId),
    upload: pending === null ? null : uploadMetadata(pending.fileUploadUrl),
  };
}

export async function authenticatedRequest() {
  const env = process.env;
  for (const name of ['PARTNER_CENTER_TENANT_ID', 'PARTNER_CENTER_CLIENT_ID', 'PARTNER_CENTER_CLIENT_SECRET']) {
    demand(typeof env[name] === 'string' && env[name].trim().length > 0, 'Missing protected credential');
  }
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(env.PARTNER_CENTER_TENANT_ID)}/oauth2/token`,
    {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
      body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: env.PARTNER_CENTER_CLIENT_ID,
        client_secret: env.PARTNER_CENTER_CLIENT_SECRET,
        resource: 'https://manage.devcenter.microsoft.com',
      }),
    },
  );
  demand(response.status === 200, 'Protected authentication failed');
  const { access_token: token } = await response.json();
  demand(typeof token === 'string' && token.length > 0, 'Missing access token');
  return async (url) => {
    demand(url === API || new RegExp(`^${API}/submissions/[1-9]\\d{1,30}$`).test(url),
      'Read-only endpoint not allowlisted');
    const result = await fetch(url, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    demand(result.status === 200, 'Read-only Store request failed');
    return result.json();
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await inspect(await authenticatedRequest());
    const output = JSON.stringify(result, null, 2);
    process.stdout.write(`${output}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Read-only Store recovery inspection\n\n\`\`\`json\n${output}\n\`\`\`\n`);
    }
  } catch {
    process.stderr.write('Store inspection failed. No Store mutation was attempted; private response details suppressed.\n');
    process.exitCode = 1;
  }
}
