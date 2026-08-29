// Lint and format configuration.
//
// The rules here were chosen by measuring the code that already exists rather than by
// taking a house style off the shelf: 2-space indent, single quotes, trailing commas on
// multi-line literals, and arrow parameters always parenthesised (206 occurrences of
// `(x) =>` and none of `x =>`). Anything that would have reflowed working code was left
// out. In particular there is no max-len: the 99th percentile line is 115 characters and
// the longest is 362, almost all of them deliberate single-line data or comment prose,
// and wrapping them would bury the actual history under a formatting commit.
//
// `npm run lint` reports; `npm run lint:fix` applies the fixable subset.

import js from '@eslint/js';
import globals from 'globals';
import stylistic from '@stylistic/eslint-plugin';

const stylisticRules = {
  '@stylistic/indent': ['error', 2, { SwitchCase: 1 }],
  '@stylistic/quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: 'always' }],
  '@stylistic/semi': ['error', 'always'],
  '@stylistic/comma-dangle': ['error', 'always-multiline'],
  '@stylistic/arrow-parens': ['error', 'always'],
  '@stylistic/no-trailing-spaces': 'error',
  '@stylistic/eol-last': ['error', 'always'],
  '@stylistic/space-before-blocks': 'error',
  '@stylistic/keyword-spacing': 'error',
  '@stylistic/comma-spacing': 'error',
  '@stylistic/no-multiple-empty-lines': ['error', { max: 2, maxEOF: 0 }],
};

const correctnessRules = {
  // The app stores reading progress, so an accidental global or a dropped promise is a
  // data-loss risk rather than a style opinion.
  'no-implicit-globals': 'error',
  'no-var': 'error',
  'prefer-const': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-console': 'off',
  // Deliberately not enabling no-await-in-loop. Sequential awaits are the point in this
  // codebase: the rate limiter and the vendor scripts pace requests to the metadata
  // service on purpose, and turning it on required 23 suppressions for correct code.
};

// Repository Constraint 11: no em dashes in the copy the app puts on screen. Two had been
// sitting in shipped strings since before the constraint was written down, found only when
// someone scanned by hand, and the scan that was supposed to catch them could not fail.
//
// This runs on the syntax tree rather than on the text of the file, which is the whole point:
// a comment is neither a Literal nor a TemplateElement, so the six dashes in the comments of
// this codebase stay legal and no suppression is needed for them. Constraint 11 names shipped
// surfaces, and only these two node types can become one.
//
// The en dash is included because the house rule is wider than the constraint. It is a house
// rule rather than the constraint, so a hit on one is worth reading before rewriting.
const noEmDashInShippedCopy = {
  'no-restricted-syntax': ['error',
    {
      selector: 'Literal[value=/[\\u2013\\u2014]/]',
      message: 'Constraint 11: no en or em dash in a string the app can put on screen.',
    },
    {
      selector: 'TemplateElement[value.raw=/[\\u2013\\u2014]/]',
      message: 'Constraint 11: no en or em dash in a string the app can put on screen.',
    },
  ],
};

export default [
  {
    ignores: [
      'node_modules/**',
      'docs/ux-artifacts/**',
      '.copilot-tracking/**',
      'src/data/**',
      'src/vendor/**',
      // Generated from src/data/hickman_full.json and consumed only by the static design
      // mockups. It is embedded JSON, so normalising its quotes would be undone the next
      // time it is regenerated.
      'design/mockups/mock-data.js',
    ],
  },
  js.configs.recommended,
  {
    plugins: { '@stylistic': stylistic },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: { ...stylisticRules, ...correctnessRules },
  },
  {
    // Everything served out of src/ runs in the browser.
    files: ['src/**/*.js'],
    languageOptions: { globals: globals.browser },
    rules: noEmDashInShippedCopy,
  },
  {
    // The server, the build scripts and the tests run in Node.
    files: ['server.mjs', 'scripts/**/*.mjs', 'test/**/*.js', 'packaging/windows/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['design/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    // The browser check is a Node program that carries browser code inside it: the functions
    // handed to puppeteer are serialised and run in the page, so `window` and `document` are
    // defined for them and for nothing else in the file. Linting it as Node alone reported 38
    // undefined globals for code that is correct, and linting it as browser alone would hide a
    // real mistake in the Node half. Both sets is the honest description of what the file is.
    // The upgrade check is the same shape for the same reason.
    files: [
      'scripts/browser-check.mjs',
      'scripts/capture-store-assets.mjs',
      'scripts/upgrade-check.mjs',
    ],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
