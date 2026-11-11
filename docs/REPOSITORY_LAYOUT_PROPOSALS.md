# Repository layout proposals

The current folders mix three kinds of work: the shared tracker, platform wrappers, and tools that
prepare or check releases. A clearer map helps contributors without changing the app.
These are proposals, not approved moves. No runtime, tooling or platform files move in this change.

## Recommendation and ranking

| Rank | Option | Benefit | Cost and decision |
|---|---|---|---|
| 1 | Keep the served app in place; group platform code and tools in small later changes | Makes ownership clearer without changing browser module addresses | Medium to high overall; approve one measured move at a time, starting with tooling |
| 2 | Keep all current folders and improve their local navigation | Lowest risk; the architecture map already gives newcomers a starting point | Low; choose this if path churn would interrupt product work |
| 3 | Put each delivered surface under `apps/` | Strong visual separation of delivered apps | Very high; not recommended without a demonstrated need that outweighs migration risk |

Use option 2 now. Option 1 is the recommended destination if the owner chooses a folder migration.
Do not introduce workspaces, packages, a browser build, or runtime dependencies to get there.
Renaming a folder does not by itself improve reliability.

## Option 1: Group by responsibility

Keep the browser's source tree and root launch commands stable. Separate native and host code
from the shared pages, and group tools by the job a contributor is doing.

```text
src/                         Shared tracker pages, modules and bundled data, unchanged
platforms/
  windows/
    cloud/                   Current host/
    ...                      Current packaging/windows/
  android/                   Current packaging/android/
  ios/                       Current packaging/ios/
scripts/
  checks/                    Deterministic check-* tools
  content/                   Authoring, vendoring and their owned data
  release/                   Packaging, release and store tools
  lib/                       Genuinely shared tool helpers
pages/                       Public information site, unchanged
test/                        Existing test root, unchanged
docs/                        Guides and detailed references
design/                      Studies and mockups
.github/                     GitHub workflows, templates and agent instructions
server.mjs                   Existing desktop entry, unchanged
```

The arrows below describe candidate moves, not a bulk rename plan. A later Issue must inventory
the exact consumers before choosing any slice. Costs are relative, not time estimates.

| Candidate move | Links and scripts | Packaging and CI | Tests and anchored citations | Cost |
|---|---|---|---|---|
| `host/` to `platforms/windows/cloud/` | Update server imports, host imports, configuration readers and architecture links | Update Windows archive selection, startup source allowlists and build-input digests; preserve credential boundaries | Update host/startup fixtures and import allowlists; inventory citations both to and from host files; immutable source records remain pinned | High |
| `packaging/windows/` to `platforms/windows/` | Update launcher, manifest, support and command references | Update MSIX staging, signing, asset and Store proof inputs plus workflow paths; inspect final package contents and startup qualification | Run Windows packaging/startup checks and installed proof when required; re-aim live citations, not historical declarations | High |
| `packaging/android/` to `platforms/android/` | Update prepare/browser tools, Gradle paths and platform documentation | Update SDK/build working directories, native evidence paths, artifacts and workflow caches | Update preparation and native test paths; run applicable native/browser checks; preserve pinned historical evidence and validate live Android citations | High |
| `packaging/ios/` to `platforms/ios/` | Update prepare scripts, Xcode project references and platform documentation | Update project, scheme, signing/export paths, workflow working directories and artifacts; do not spend a release build number to test a rename | Run preparation and simulator checks plus required device evidence; recheck iOS source citations after the final tree is stable | High |
| `scripts/check-*.mjs` to `scripts/checks/` | Keep npm command names; update package script paths, relative imports and command links | Update direct workflow invocations and any check discovery/allowlists | Update direct test imports and temporary fixtures; citation targets move even when contents do not; recheck anchors after all edits | Medium |
| Content tools and their owned `scripts/data/` files to `scripts/content/` | Move an owner and its data together; update CLI imports, manifest paths and runbooks | Update vendoring/preparation commands and workflow invocations; generated `src/data/` stays put | Update authoring fixtures and source-path records; compare generated bytes to prevent a rename from changing content; source/claim links need explicit mapping | Medium to high |
| Release and store tools to `scripts/release/` | Update package commands, helper imports and release runbooks | Update protected workflow commands, source pinning and artifact paths; preserve approval and first-attempt rules | Run offline qualification tests first; any installed or Store operation still needs its own approval; live and historical citations have different treatment | High |

Start with one small deterministic check tool and all its consumers. It has no served browser URL
or credential flow. Measure the actual diff and verification cost before approving the next group.
Keep a root command only when someone uses it as a stable interface; do not leave forwarding files
for every old internal path indefinitely.

## Option 2: Preserve folders, add navigation

Keep `src`, `host`, `packaging`, `scripts`, `pages`, `test`, `docs` and `design` where they are.
Use the [architecture map](ARCHITECTURE.md#find-the-part-you-need) as the entry point. If an Issue
needs more local navigation, add a short folder guide naming its entry commands, owners and tests.
Link to the detailed source of truth rather than copying its rules.

There are no script, package, CI or test-path migrations. New local documentation links must resolve;
any new file-and-line claim still enters the anchors check. The tradeoff is that `scripts/` remains
busy and `host/` needs its Windows role explained. Extra indexes must not become another set of
inventories to maintain by hand.

## Option 3: Separate every delivered app

```text
apps/
  tracker/                   Current src/
  desktop/                   Root server, host and Windows wrapper
  android/                   Current Android wrapper
  ios/                       Current iOS wrapper
  website/                   Current pages/
tools/                       Current scripts/
test/
docs/
design/
.github/
```

This makes the delivered surfaces obvious but can imply independent applications where the wrappers
actually share pages. It adds no product capability.

| Candidate move | Links and scripts | Packaging and CI | Tests and anchored citations | Cost |
|---|---|---|---|---|
| `src/` to `apps/tracker/` | Rewrite server root, module/tool imports and data/source links; retain all served URLs and the exact desktop origin | Rewrite every platform preparer and source allowlist; keep manifest/worker scope, cache behavior and packaged paths stable | Verify all ordinary browser and upgrade journeys, offline behavior, every platform's generated bytes and affected source citations; historical records keep literal paths | Very high |
| Root server/launchers, `host/` and Windows wrapper to `apps/desktop/` | Preserve documented root launch commands or explicitly migrate them; update working-directory assumptions and imports | Requalify startup identity, packaged entry paths, configuration resolution and Store inputs | Run startup, archive, MSIX and installed checks; recheck both incoming and outgoing citations and support instructions | Very high |
| Android and iOS wrappers to `apps/android/` and `apps/ios/` | Same platform path changes as option 1, plus new shared-source paths | Same platform costs as option 1, coupled to the tracker move | Same native and citation checks as option 1, plus shared-page equivalence | Very high |
| `pages/` to `apps/website/` | Update static builder, document links and publication-source allowlists | Update Pages source selection and artifact checks; never include tracker files in the website | Run website/build/publication tests; inspect deployment artifact allowlist and re-aim live citations | Medium |
| `scripts/` to `tools/` | Rewrite package scripts, relative imports and documented commands throughout | Rewrite workflow commands and script allowlists, including protected release workflows | Update direct imports, fixtures and publication checks; broad citation churn with no behavior gain | High |

Do not choose this merely to resemble a monorepo. The current zero-build browser architecture does
not need separate package manifests or a shared-code package.

## Acceptance conditions for any later move

Record scope and ownership in a separate Issue. Start from an agreed revision, map old paths to new
paths, and enumerate inbound links, commands, imports, generated records and packaging allowlists.
Agree on shared-file ownership before parallel work.

Keep the exact desktop address and served app URLs. Preserve saved-data formats, offline scope,
security boundaries and release approvals. Regenerate only owned outputs and explain any byte change.
Run all repository gates and the affected platform checks.

Follow the [citation workflow](MAINTAINING.md#relocate-citations-and-resolve-renumber-only-conflicts).
A path rename needs review of claims as well as range arithmetic; do not assume the numeric relocation
helper handles a rename. Keep immutable source paths and history declarations intact unless their
separate approved procedure requires a change. Recheck every affected citation after rebasing.
No automatic blessing or blanket history rewrite is acceptable.

## HVE Core guidance and its limits

Sources below were read on **November 10, 2026**. Installed-plugin paths are relative to the HVE Core
plugin root, not this repository. They identify what was read without requiring contributors to
install that plugin.

| Source | Guidance used here |
|---|---|
| [HVE writing instructions](https://github.com/microsoft/hve-core/blob/main/.github/instructions/hve-core/writing-style.instructions.md) | Match vocabulary to the reader, define jargon, put important information first and group related material |
| `skills/hve-core/documentation/references/conventions.md` in the installed plugin | Use concise sections, accurate commands and repository conventions; avoid style-only scope expansion |
| `skills/hve-core/documentation/templates/guide.md` and `templates/reference.md` in that documentation skill | Separate task steps and expected outcomes from detailed contracts and limitations |
| `skills/hve-core/documentation/references/code-doc-mapping.md` in the installed plugin | Pair implementation changes with their references and review path/command changes for drift |
| [HVE contributor guide](https://github.com/microsoft/hve-core/blob/main/CONTRIBUTING.md#your-first-code-contribution) | Coordinate through an Issue before coding; this project's maintainer authority still comes from its own governance |
| [HVE repository overview](https://github.com/microsoft/hve-core/blob/main/README.md#navigate-this-repository) | Offer a goal-based repository map; the same README warns that HVE is evolving patterns to evaluate, not a stable production dependency |

HVE's Documentation agent at `agents/hve-core/documentation.md` routes authoring and validation
through its documentation skill. That skill prefers existing repository checks and factual scope.
Those are the practices applied here. HVE does **not** prescribe any of these exact folder names
or certify a layout as production-grade. The layouts and cost judgments are project-specific proposals.
