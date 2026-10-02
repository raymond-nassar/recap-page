import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Intake configuration fails open in the same way the dependency config does. A CODEOWNERS rule
// naming a path that no longer exists is not rejected and produces no warning: it simply stops
// matching, and the area it was written to protect goes unowned while the file still reads as
// though it is covered. A label an issue form asks for that the repository does not have is
// dropped silently at creation. A contact link pointing at a moved document renders as an
// ordinary link and 404s only for the person following it. None of these has a symptom you would
// notice from the repository, which is why the expectations below are derived from the repository
// itself rather than read back out of the files being checked.

const root = new URL('../', import.meta.url);
const read = (relative) => readFileSync(new URL(relative, root), 'utf8');
const exists = (relative) => existsSync(fileURLToPath(new URL(relative, root)));

const codeowners = read('.github/CODEOWNERS');
const prTemplate = read('.github/PULL_REQUEST_TEMPLATE.md');
const issueConfig = read('.github/ISSUE_TEMPLATE/config.yml');
const security = read('SECURITY.md');
const instructions = read('.github/copilot-instructions.md');

const formNames = readdirSync(fileURLToPath(new URL('.github/ISSUE_TEMPLATE/', root)))
  .filter((name) => name.endsWith('.yml') && name !== 'config.yml')
  .sort();
const forms = formNames.map((name) => ({ name, text: read(`.github/ISSUE_TEMPLATE/${name}`) }));

function ownershipRules(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      return { pattern: parts[0], owners: parts.slice(1) };
    });
}

// Only the three pattern shapes this file uses are understood, and an unrecognised shape is a
// failure rather than a miss. A matcher that quietly returned false for a wildcard rule would
// report every area unowned, or worse, report an area owned by a rule it had misread.
function matchShape(pattern) {
  if (pattern === '*') return 'all';
  if (!pattern.startsWith('/')) return null;
  return pattern.endsWith('/') ? 'directory' : 'file';
}

function ownsPath(rule, path) {
  const shape = matchShape(rule.pattern);
  if (shape === 'all') return true;
  const bare = rule.pattern.slice(1);
  if (shape === 'directory') return path.startsWith(bare);
  return path === bare;
}

const rules = ownershipRules(codeowners);

test('every ownership rule uses a pattern shape this check understands', () => {
  for (const rule of rules) {
    assert.notEqual(
      matchShape(rule.pattern),
      null,
      `${rule.pattern} is a pattern shape this check cannot evaluate, so extend the matcher rather than trusting it`,
    );
  }
});

test('every ownership rule names an owner', () => {
  // A pattern with no owner after it is valid CODEOWNERS and un-assigns whatever an earlier rule
  // had assigned, so the footgun looks identical to a rule that assigns.
  for (const rule of rules) {
    assert.ok(rule.owners.length > 0, `${rule.pattern} has no owner, which un-assigns it`);
    for (const owner of rule.owners) {
      assert.match(owner, /^@[\w-]+(\/[\w-]+)?$/, `${owner} is not a handle or a team`);
    }
  }
});

test('every path an ownership rule names still exists', () => {
  for (const rule of rules) {
    const shape = matchShape(rule.pattern);
    // An unreadable shape is already a failure above, and reading a path out of one here would
    // report a second failure describing a path nobody wrote.
    if (shape === 'all' || shape === null) continue;
    const bare = rule.pattern.slice(1);
    assert.ok(exists(bare), `${rule.pattern} names a path that is not in the repository`);
    const directory = statSync(fileURLToPath(new URL(bare, root))).isDirectory();
    assert.equal(
      directory,
      shape === 'directory',
      `${rule.pattern} is written as a ${shape} but is a ${directory ? 'directory' : 'file'}`,
    );
  }
});

test('every workflow is owned by a rule written for it rather than by the catch-all', () => {
  const workflows = readdirSync(fileURLToPath(new URL('.github/workflows/', root)))
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => `.github/workflows/${name}`);
  assert.ok(workflows.length > 0, 'no workflows found, so this check would pass vacuously');
  for (const path of workflows) {
    const specific = rules.filter((rule) => rule.pattern !== '*' && ownsPath(rule, path));
    assert.ok(specific.length > 0, `${path} is covered only by the catch-all`);
  }
});

test('blank issues stay enabled, because the security policy sends reporters through one', () => {
  // These two files have to agree and nothing else makes them. The policy tells a reporter who
  // cannot use private reporting to open an issue asking for a channel and to put no detail in
  // it. Every form here asks for detail and says not to paste anything private, so with blank
  // issues off that instruction would have nowhere to land.
  assert.match(security, /open an issue asking how to send a private report/);
  assert.match(security, /Put no details in it/);
  assert.match(issueConfig, /^blank_issues_enabled:\s*true\s*$/m);
});

test('every contact link into this repository names a file that is still there', () => {
  const links = [...issueConfig.matchAll(/^\s*url:\s*(\S+)\s*$/gm)].map((match) => match[1]);
  assert.ok(links.length > 0, 'no contact links found, so this check would pass vacuously');
  const prefix = 'https://github.com/raymond-nassar/recap-page/blob/main/';
  let checked = 0;
  for (const url of links) {
    if (!url.startsWith(prefix)) continue;
    checked += 1;
    assert.ok(exists(url.slice(prefix.length)), `${url} points at a file that is not here`);
  }
  assert.ok(checked > 0, 'no link pointed into this repository, so nothing was checked');
});

test('every issue form is complete enough to be worth filling in', () => {
  assert.ok(forms.length >= 3, 'expected forms for defects, requests and data corrections');
  for (const form of forms) {
    assert.match(form.text, /^name:\s*\S/m, `${form.name} has no name`);
    assert.match(form.text, /^description:\s*\S/m, `${form.name} has no description`);
    assert.match(form.text, /^body:\s*$/m, `${form.name} has no body`);
    assert.ok(/^\s+required:\s*true\s*$/m.test(form.text), `${form.name} requires nothing`);
  }
});

test('no issue form asks for a label this repository would drop', () => {
  // GitHub's nine defaults, which every repository is created with. A form may name none, and
  // one of these does so deliberately, but naming anything outside this set would depend on a
  // label having been created by hand, and the failure if it has not is silent.
  const defaults = new Set([
    'bug',
    'documentation',
    'duplicate',
    'enhancement',
    'good first issue',
    'help wanted',
    'invalid',
    'question',
    'wontfix',
  ]);
  for (const form of forms) {
    // GitHub documents labels as an array or a comma-delimited string, so a form may write it
    // in block style or bare. Only the flow sequence is read here, and a shape this cannot read
    // is a failure rather than a skip, for the same reason an unreadable ownership pattern is:
    // a matcher that quietly returns nothing reports every form clean.
    const key = /^labels:/m.test(form.text);
    const declared = /^labels:\s*\[([^\]]*)\]\s*$/m.exec(form.text);
    if (!key) continue;
    assert.ok(declared, `${form.name} declares labels in a shape this check cannot read`);
    const labels = declared[1]
      .split(',')
      .map((label) => label.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
    for (const label of labels) {
      assert.ok(defaults.has(label), `${form.name} asks for ${label}, which is not a default label`);
    }
  }
});

// Nothing in this repository parses YAML, and adding a parser would cost the property that the
// test suite runs in a fresh copy with nothing installed. So the check below is narrow on
// purpose: it reads the one construct that actually breaks a hand-written form. A plain scalar
// cannot contain a colon followed by a space, because the parser reads the second colon as a
// nested key. That is not a hypothetical: `data-order.yml` shipped into review with a colon in
// its description, every text assertion above passed, and GitHub would have refused to offer
// the form at all. The symptom is invisible from the repository, which is what every check in
// this file is for.
function plainScalarFaults(text) {
  const lines = text.split(/\r?\n/);
  const faults = [];
  let blockIndent = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Lines inside a block scalar are literal text. The prose bodies are full of colons and
    // reading them as mappings would report a fault on every form.
    if (blockIndent !== null) {
      if (line.trim() === '' || line.match(/^\s*/)[0].length > blockIndent) continue;
      blockIndent = null;
    }
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    const match = /^(\s*)(?:-\s+)?([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (!match) continue;
    const [, indent, key, raw] = match;
    const value = (raw ?? '').trim();
    if (/^[|>][-+]?$/.test(value)) {
      blockIndent = indent.length;
      continue;
    }
    if (value === '' || /^["'[{]/.test(value)) continue;
    if (value.includes(': ')) faults.push(`${key} on line ${i + 1} contains a colon and a space`);
    if (value.endsWith(':')) faults.push(`${key} on line ${i + 1} ends with a colon`);
    if (/^[&*!%@`]/.test(value)) faults.push(`${key} on line ${i + 1} opens with ${value[0]}`);
  }
  return faults;
}

test('no intake file writes a plain scalar the YAML parser would reject', () => {
  const files = [
    ['.github/ISSUE_TEMPLATE/config.yml', issueConfig],
    ...forms.map((form) => [`.github/ISSUE_TEMPLATE/${form.name}`, form.text]),
  ];
  for (const [name, text] of files) {
    assert.deepEqual(plainScalarFaults(text), [], `${name} would not parse`);
  }
});

// The detector has to be wrong in the safe direction too. A quoted value may contain anything,
// and so may the body of a block scalar, so a check that flagged either would be turned off by
// the first person it inconvenienced.
test('the plain scalar check accepts what YAML accepts', () => {
  assert.deepEqual(plainScalarFaults('description: "a: b"'), []);
  assert.deepEqual(plainScalarFaults('labels: [bug, question]'), []);
  assert.deepEqual(plainScalarFaults('value: |\n  a: b\n  c: d\n'), []);
  assert.equal(plainScalarFaults('description: a: b').length, 1);
});

test('the pull request template asks for the opening the instructions require', () => {
  // Read the required heading out of the contributor instructions rather than repeating it here,
  // so that renaming it in one place fails instead of drifting.
  const required = /under the heading\s+`([^`]+)`/.exec(instructions);
  assert.ok(required, 'the instructions no longer name a required heading');
  assert.ok(
    prTemplate.startsWith(`${required[1]}\n`) || prTemplate.startsWith(`${required[1]}\r\n`),
    `the template does not open with ${required[1]}`,
  );
});

test('no intake file carries a citation, which the evidence gate would enroll as a claim', () => {
  // A template is a form for someone else to fill in, not an assertion about this codebase. A
  // file and line written into one would be collected by the evidence gate as a live claim and
  // blessed into the lock, where it would then have to be maintained forever to describe an
  // example.
  const citation = /([A-Za-z0-9_./-]+\.(?:js|mjs|css|html|json|yml|md)):(\d+)(?:-(\d+))?/;
  const files = [
    ['.github/PULL_REQUEST_TEMPLATE.md', prTemplate],
    ['.github/CODEOWNERS', codeowners],
    ['.github/ISSUE_TEMPLATE/config.yml', issueConfig],
    ...forms.map((form) => [`.github/ISSUE_TEMPLATE/${form.name}`, form.text]),
  ];
  for (const [name, text] of files) {
    const found = citation.exec(text);
    assert.equal(found, null, `${name} contains ${found ? found[0] : ''}`);
  }
});
