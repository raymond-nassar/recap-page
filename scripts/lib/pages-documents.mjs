// Renders the project's reader-facing Markdown documents into project home pages at build time.
// App stores reject a privacy policy or support page that is a file view in a code repository, so
// these pages are generated from the same Markdown the repository keeps. The converter accepts only
// the small subset those documents use and throws on anything else, because a construct it silently
// mangled would publish a policy that no longer says what its source says.

export const REPOSITORY = 'https://github.com/raymond-nassar/recap-page';
export const PROJECT_HOME = 'https://raymond-nassar.github.io/recap-page/';

export const PAGE_DOCUMENTS = Object.freeze([
  Object.freeze({
    source: 'SUPPORT.md',
    destination: 'support.html',
    label: 'Support',
    description: 'Get help with Recap Page, report a problem, or suggest a change.',
  }),
  Object.freeze({
    source: 'PRIVACY.md',
    destination: 'privacy.html',
    label: 'Privacy',
    description: 'What Recap Page keeps on your device, what leaves it, and how to delete it.',
  }),
  Object.freeze({
    source: 'pages/data-sources.md',
    destination: 'data-sources.html',
    label: 'Data sources',
    description: 'Where Recap Page gets comic details, covers, and reading lists.',
  }),
  Object.freeze({
    source: 'pages/being-built.md',
    destination: 'being-built.html',
    label: "What's being built",
    description: 'The major features being added to Recap Page and where they stand.',
  }),
]);

// Kept identical to the project home so every page carries the same icon without a second file.
export const SITE_ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNyIgZmlsbD0iIzZkMjhkOSIvPjxyZWN0IHg9IjgiIHk9IjUuNSIgd2lkdGg9IjE2IiBoZWlnaHQ9IjcuNSIgcng9IjEuNjI1IiBmaWxsPSIjZmZmZmZmIi8+PHBvbHlnb24gcG9pbnRzPSI4LDE1LjUgMTYsMTUuNSAxMy4yNSwyNi41IDgsMjYuNSIgZmlsbD0iI2ZmZmZmZiIvPjxwb2x5Z29uIHBvaW50cz0iMTgsMTUuNSAyNCwxNS41IDI0LDI2LjUgMTUuNzUsMjYuNSIgZmlsbD0iIzllNzFlNiIvPjwvc3ZnPg==';

export function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// Matches the anchors GitHub gives the same headings, so links written against the repository file,
// such as the deletion section a store console points at, keep working on the published page.
export function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

export function resolveDocumentLink(target, sourcePath) {
  if (/^https?:\/\//.test(target)) {
    if (target === PROJECT_HOME || target.startsWith(`${PROJECT_HOME}#`)) {
      return `./index.html${target.slice(PROJECT_HOME.length)}`;
    }
    return target;
  }
  if (target.startsWith('#')) return target;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) {
    throw new Error(`Unsupported link ${JSON.stringify(target)} in ${sourcePath}`);
  }

  const baseParts = sourcePath.split('/').slice(0, -1);
  const [path, fragment] = target.split('#');
  const parts = [...baseParts];
  for (const part of path.split('/')) {
    if (part === '..') {
      if (parts.length === 0) throw new Error(`Link ${target} leaves the repository in ${sourcePath}`);
      parts.pop();
    } else if (part !== '.' && part !== '') {
      parts.push(part);
    }
  }
  const resolved = parts.join('/');
  const hash = fragment === undefined ? '' : `#${fragment}`;

  const page = PAGE_DOCUMENTS.find(({ source }) => source === resolved);
  if (page) return `./${page.destination}${hash}`;
  // The data sources page summarises this record, so a plain link to the record lands on the
  // summary, while a link to one of its sections still needs the full document.
  if (resolved === 'docs/DATA_PROVENANCE.md' && !hash && sourcePath !== 'pages/data-sources.md') {
    return './data-sources.html';
  }
  return `${REPOSITORY}/blob/main/${resolved}${hash}`;
}

const MARKDOWN_ENTITY = /&(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);/i;

function renderInline(text, sourcePath) {
  if (/<|>/.test(text)) {
    throw new Error(`Raw HTML is not supported in ${sourcePath}: ${text}`);
  }
  if (/!\[/.test(text)) {
    throw new Error(`Images are not supported in ${sourcePath}: ${text}`);
  }

  let output = '';
  let rest = text;
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/;
  while (rest.length > 0) {
    const match = pattern.exec(rest);
    if (!match) {
      output += plain(rest, sourcePath);
      break;
    }
    output += plain(rest.slice(0, match.index), sourcePath);
    if (match[1] !== undefined) {
      output += `<code>${escapeHtml(match[1])}</code>`;
    } else if (match[2] !== undefined) {
      output += `<strong>${renderInline(match[2], sourcePath)}</strong>`;
    } else {
      // These destination forms need Markdown parsing, not just HTML escaping.
      if (/[\\(]/.test(match[4]) || MARKDOWN_ENTITY.test(match[4])) {
        throw new Error(`Unsupported link destination in ${sourcePath}: ${match[4]}`);
      }
      const href = resolveDocumentLink(match[4], sourcePath);
      output += `<a href="${escapeHtml(href)}">${renderInline(match[3], sourcePath)}</a>`;
    }
    rest = rest.slice(match.index + match[0].length);
  }
  return output;
}

// GitHub would turn each of these into something other than the literal characters: emphasis,
// strikethrough, an escape, an entity, a table, or an automatic link.
const UNSUPPORTED_INLINE = /[`*[\]~\\|]|(^|\W)_\S|\S_(\W|$)|https?:\/\/|www\./i;

function plain(text, sourcePath) {
  if (UNSUPPORTED_INLINE.test(text) || MARKDOWN_ENTITY.test(text)) {
    throw new Error(`Unsupported inline syntax in ${sourcePath}: ${text}`);
  }
  return escapeHtml(text);
}

// Indented, quoted, tabled, fenced, ordered, starred, raw HTML, a heading marker this converter
// does not accept, and a line of only dashes or equals signs, which is a rule or a setext heading.
const UNSUPPORTED_BLOCK = /^(?:\s|>|\||-\t|```|~~~|\d+[.)](?:\s|$)|[*+](?:\s|$)|<|[-=]+\s*$|#{1,6}(?:\t|$)|#{7,}\s)/;
const HEADING = /^(#{1,6}) ([^\t]*[^\s#])\s*$/;

function refuseBlock(line, sourcePath) {
  if (UNSUPPORTED_BLOCK.test(line) || (/^#{1,6} /.test(line) && !HEADING.test(line))) {
    throw new Error(`Unsupported block syntax in ${sourcePath}: ${line}`);
  }
}

export function renderMarkdown(markdown, sourcePath) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  const slugs = new Set();
  let title = null;
  let index = 0;

  function headingId(text) {
    const base = slugify(text);
    if (base === '') throw new Error(`Heading has no usable anchor in ${sourcePath}: ${text}`);
    let candidate = base;
    let suffix = 1;
    while (slugs.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    slugs.add(candidate);
    return candidate;
  }

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      index += 1;
      continue;
    }

    refuseBlock(line, sourcePath);
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (level > 2) throw new Error(`Heading level ${level} is not supported in ${sourcePath}: ${line}`);
      const text = heading[2].trim();
      if (/\[[^\]]+\]\([^)]+\)/.test(text)) {
        throw new Error(`Links in headings are not supported in ${sourcePath}: ${line}`);
      }
      if (level === 1) {
        if (title !== null) throw new Error(`${sourcePath} has more than one top-level heading`);
        if (blocks.length > 0) throw new Error(`${sourcePath} must open with its top-level heading`);
        title = text;
      }
      blocks.push(`<h${level} id="${headingId(text)}">${renderInline(text, sourcePath)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^- /.test(line)) {
      const items = [];
      while (index < lines.length && /^- /.test(lines[index])) {
        const item = [lines[index].slice(2)];
        refuseBlock(item[0], sourcePath);
        if (/^#{1,6} |^- /.test(item[0])) {
          throw new Error(`Nested blocks are not supported in ${sourcePath}: ${lines[index]}`);
        }
        index += 1;
        while (index < lines.length && /^ {2}\S/.test(lines[index])) {
          const continuation = lines[index].slice(2);
          if (/^(?:- |#{1,6} )/.test(continuation)) {
            throw new Error(`Nested blocks are not supported in ${sourcePath}: ${lines[index]}`);
          }
          refuseBlock(continuation, sourcePath);
          item.push(continuation.trim());
          index += 1;
        }
        // GitHub folds an unindented line straight after an item into that item, which this
        // converter would publish as a separate paragraph.
        if (index < lines.length && lines[index].trim() !== '' && !/^- /.test(lines[index])) {
          throw new Error(`Unsupported block syntax in ${sourcePath}: ${lines[index]}`);
        }
        items.push(`  <li>${renderInline(item.join(' '), sourcePath)}</li>`);
      }
      blocks.push(`<ul>\n${items.join('\n')}\n</ul>`);
      continue;
    }

    const paragraph = [];
    while (
      index < lines.length
      && lines[index].trim() !== ''
      && !/^(#{1,6} |- )/.test(lines[index])
    ) {
      refuseBlock(lines[index], sourcePath);
      paragraph.push(lines[index].trim());
      index += 1;
    }
    if (paragraph.length === 0) {
      throw new Error(`Unsupported block syntax in ${sourcePath}: ${line}`);
    }
    blocks.push(`<p>${renderInline(paragraph.join(' '), sourcePath)}</p>`);
  }

  if (title === null) throw new Error(`${sourcePath} has no top-level heading`);
  return { title, html: blocks.join('\n') };
}

const FOOTER_LINKS = [
  ['./privacy.html', 'Privacy'],
  ['./support.html', 'Support'],
  ['./data-sources.html', 'Data sources'],
  [`${REPOSITORY}/blob/main/SECURITY.md`, 'Security'],
  [`${REPOSITORY}/blob/main/LICENSE`, 'License'],
];

export function renderFooter(indent = '    ') {
  const links = FOOTER_LINKS
    .map(([href, label]) => `${indent}      <a href="${href}">${label}</a>`)
    .join('\n');
  return [
    `${indent}<footer class="footer">`,
    `${indent}  <div class="shell">`,
    `${indent}    <p class="hosting-note">`,
    `${indent}      GitHub hosts this site and receives request details, including your IP address.`,
    `${indent}      This site can't access your saved reading data.`,
    `${indent}    </p>`,
    `${indent}    <p>`,
    `${indent}      Unofficial fan project. Not affiliated with or endorsed by Marvel Entertainment.`,
    `${indent}    </p>`,
    `${indent}    <p>`,
    links,
    `${indent}    </p>`,
    `${indent}  </div>`,
    `${indent}</footer>`,
  ].join('\n');
}

export function renderDocumentPage(document, markdown) {
  const { title, html } = renderMarkdown(markdown, document.source);
  const navigation = [
    ['./index.html', 'Home'],
    ...PAGE_DOCUMENTS.map(({ destination, label }) => [`./${destination}`, label]),
  ]
    .map(([href, label]) => {
      const current = href === `./${document.destination}` ? ' aria-current="page"' : '';
      return `            <li><a href="${href}"${current}>${label}</a></li>`;
    })
    .join('\n');
  const body = html
    .split('\n')
    .map((line) => (line ? `          ${line}` : line))
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <meta name="referrer" content="no-referrer" />
    <meta name="description" content="${escapeHtml(document.description)}" />
    <title>${escapeHtml(title)} | Recap Page</title>
    <link rel="icon" href="${SITE_ICON}" />
    <link rel="stylesheet" href="./site.css" />
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to main content</a>

    <header class="masthead">
      <div class="shell">
        <p class="site-name"><a href="./index.html">Recap Page</a></p>
        <nav class="section-nav" aria-label="Site">
          <ul>
${navigation}
          </ul>
        </nav>
      </div>
    </header>

    <main id="main">
      <div class="section shell">
        <article class="document">
${body}
        </article>
      </div>
    </main>

${renderFooter()}
  </body>
</html>
`;
}
