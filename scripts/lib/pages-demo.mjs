import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';

export const DEMO_INPUTS = ['pages/demo.js', 'pages/demo.css'];
export const DEMO_LIST_IDS = ['ultimate-marvel-intro', 'spider-man-best-of', 'essential-avengers'];
const MODULE_ORIGIN = 'https://recap.invalid/';
const json = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');
const dataUrl = (type, text) => `data:${type};base64,${Buffer.from(text).toString('base64')}`;

// Inline the app's module graph so an opaque-origin frame needs neither CORS nor permission
// to share the host's origin. Only module addresses change; app controllers stay the shipped ones.
export async function renderAppDemo(root) {
  const imports = {};
  const visited = new Set();
  async function collect(path) {
    if (visited.has(path)) return;
    if (!/^(?:js|data)\/[\w/-]+\.js$/.test(path)) throw new Error(`Unexpected demo module: ${path}`);
    visited.add(path);
    let source = await readFile(join(root, 'src', ...path.split('/')), 'utf8');
    const dependencies = [];
    source = source.replace(/(^import\s+(?:[^;'"]+?\s+from\s+)?)(['"])(\.[^'"]+)\2;/gm, (_, prefix, quote, specifier) => {
      const dependency = posix.normalize(posix.join(posix.dirname(path), specifier));
      dependencies.push(dependency);
      return `${prefix}${quote}${MODULE_ORIGIN}${dependency}${quote};`;
    });
    source = source.replaceAll('import.meta.url', JSON.stringify(`${MODULE_ORIGIN}${path}`));
    source = source.replaceAll('./icons/ui.svg#', '#demo-icon-');
    imports[`${MODULE_ORIGIN}${path}`] = dataUrl('text/javascript', source);
    for (const dependency of dependencies) await collect(dependency);
  }
  await collect('js/main.js');

  const catalog = JSON.parse(await readFile(join(root, 'src', 'data', 'catalog.json'), 'utf8'));
  const samples = [];
  for (const id of DEMO_LIST_IDS) {
    const entry = catalog.lists.find((list) => list.id === id);
    if (!entry || !/^[\w-]+\.json$/.test(entry.file)) throw new Error(`Missing demo list: ${id}`);
    const order = JSON.parse(await readFile(join(root, 'src', 'data', entry.file), 'utf8'));
    if (order.items.length < 3) throw new Error(`Demo list needs three source positions: ${id}`);
    samples.push({ entry, order: { ...order, items: order.items.slice(0, 3) } });
  }

  let html = await readFile(join(root, 'src', 'index.html'), 'utf8');
  const styles = await readFile(join(root, 'src', 'styles.css'), 'utf8');
  const overlayStyles = await readFile(join(root, 'pages', 'demo.css'), 'utf8');
  const runtime = await readFile(join(root, 'pages', 'demo.js'), 'utf8');
  const sprite = (await readFile(join(root, 'src', 'icons', 'ui.svg'), 'utf8'))
    .replace(/id="([^"]+)"/g, 'id="demo-icon-$1"')
    .replace('<svg ', '<svg hidden aria-hidden="true" ');
  html = html.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<link[^>]+rel="manifest"[^>]*>/, '')
    .replace(/<img[^>]+src="\.\/brands\/[^"]+"[^>]*\/>/g, '')
    .replace(/<script type="module" src="\.\/js\/app\.js"><\/script>/, '')
    .replace('<link rel="stylesheet" href="./styles.css" />', `<style>${styles}\n${overlayStyles}</style>`)
    .replaceAll('./icons/ui.svg#', '#demo-icon-');
  for (const name of ['icon.svg', 'wordmark.svg', 'wordmark-dark.svg']) {
    const svg = await readFile(join(root, 'src', 'icons', name), 'utf8');
    html = html.replaceAll(`./icons/${name}`, dataUrl('image/svg+xml', svg));
  }
  const policy = "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src data: https://i.annihil.us; connect-src 'none'; base-uri 'none'; form-action 'none'";
  html = html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${policy}" />
    <meta name="referrer" content="no-referrer" />
    <script type="importmap">${json({ imports })}</script>`);
  html = html.replace(/^\s*<body>$/m, () => `<body>
    ${sprite}
    <aside id="demo-guide" aria-label="Guided tour">
      <p id="demo-step" role="status" aria-live="polite" aria-atomic="true">Loading the app...</p>
      <p class="demo-boundary">Real app. Three-comic samples. Progress lasts only until you reset or leave.</p>
      <div class="demo-actions">
        <button type="button" class="btn btn-g" id="demo-restart">Choose another list</button>
        <button type="button" class="btn" id="demo-install" hidden>Choose your device</button>
      </div>
    </aside>`);
  return html.replace('</body>', `<script type="application/json" id="demo-samples">${json(samples)}</script>
    <script type="module">${runtime.replaceAll('</script', '<\\/script')}</script></body>`);
}
