import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const isDocumentationPath = (path) => /^(?:docs\/.*\.md|[^/]+\.md|docs\/anchors\.lock\.json)$/i.test(path)
  || /^\.github\/skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/.test(path);

export function isDocumentationOnly(paths) {
  return paths.length > 0 && paths.every(isDocumentationPath);
}

function main() {
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    const { BASE_SHA: base, HEAD_SHA: head, GITHUB_OUTPUT: output } = process.env;
    if (!/^[0-9a-f]{40}$/i.test(base ?? '') || !/^[0-9a-f]{40}$/i.test(head ?? '')) {
      throw new Error('The pull request base and head must be full commit SHAs.');
    }
    if (!output) throw new Error('GITHUB_OUTPUT is required to publish the documentation-only result.');

    const changed = execFileSync('git', ['diff', '--name-only', '-z', '--no-renames', `${base}...${head}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }).split('\0').filter(Boolean);
    const documentationOnly = isDocumentationOnly(changed);
    appendFileSync(output, `docs_only=${documentationOnly}\n`);
  } else if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, 'docs_only=false\n');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
