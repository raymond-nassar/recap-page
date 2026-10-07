# Deliver an owner Markdown reading list

## Purpose

Use this path for a new owner-selected MCU Prep guide. It replaces per-guide author scripts,
test implementations, browser implementations and current-roster edits with explicit input data
and shared checks. It does not research an ambiguous trade for you, approve a source, or merge
a pull request.

The performance goal in [the workflow issue](https://github.com/raymond-nassar/recap-page/issues/738)
is **strictly less than 60 minutes from the actual supplied Markdown handoff to actual merge**.
Preparation, exact resolution, review, repairs, hosted checks and owner/app waiting all count.
An open or ready pull request is not that result. The first real trial remains a separate guide
delivery; tooling and fixture runs do not prove the goal.

## Prerequisites

Use the guide's released worktree on actual main, the exact owner Markdown, its intake Issue,
accepted bibliography and any genuine retained metadata cache. Keep working evidence in a private
directory outside the repository. Node, Git and the existing npm development tooling are required.
The browser check uses installed Edge and the existing external `puppeteer-core` installation.
Neither becomes a runtime dependency.

Do not change frozen approvals, inventory selections, reader state, application versions or release
notes to get a guide through this path. The source is owner-authored, not Comic Book Herald.
Use the separate CBH/CBRO authoring paths for those programs.

## Start the clock at the real handoff

The examples use PowerShell variables for paths, so a path with spaces is one argument.
Set `$work` to the private evidence directory and `$markdown` to the supplied file.
Set `$handedAt` to its actual ISO timestamp, not the time you start the command.

```powershell
npm run owner:intake -- "--work=$work" "--markdown=$markdown" "--handed-at=$handedAt"
```

This preserves an exact private original, its name/hash/byte receipt, a clock and an `intake.json`
selection list. It creates `request.json` with deliberately unfilled decisions. Existing request
data is not overwritten on repeated intake. A different handoff cannot silently reset an existing
clock.

Numbered trade selections, `-`, `*` and `+` bullets, and checklists are accepted. Headings and every selected
position stay explicit. A plain original reference such as `Sample Comic (2020) #1-3` can expand
deterministically. A title such as `A writer's first volume` cannot: it needs a dated, explicit
edition or compilation decision. A formation-focused event selection is not automatically a trade
or the complete event. Nested selections, fenced content and embedded image bytes are refused.
No publisher pages or images are fetched. Each list block must use consistent top-level
indentation; nested or inconsistently indented selections need an explicit flat order.

## Prepare the exact selected scope

Fill the private request with:

| Field | Meaning |
|---|---|
| `id`, `name`, `description` | Stable lower-kebab-case identity and approved single-line reader copy |
| `sourceUrl`, `sourceRetrievedAt` | Exact repository intake Issue or decision comment and source-reading date |
| `markdownFile`, `metadataCache` | Private input and genuine cache locations; never published as dependencies |
| `metadataIssueIds` | Exact candidate IDs whose recorded metadata should be considered, including rejected candidates |
| `selections` | Explicit expansions for trades, compilations or references needing interpretation; empty for direct exact references |
| `publicFiles` | Complete additional public provenance declarations, including transitive dependencies; empty when self-contained |
| `insertionAnchor.beforeId` | Proposed current source-manifest insertion point, requiring actual review |
| `characters`, `keywords`, `coverIssueId` | Factual discovery terms and an optional exact representative original |
| `sourceFacts` | Optional self-contained factual qualifications, not copied provider prose or executable private paths |

Each explicit expansion names its `inputPosition` and the exact `inputSha256` from `intake.json`,
its reader-facing `group` (or explicit null for individual originals), an `interpretation` such as an owner compilation, dated
`evidenceSources` with `url` and `retrievedAt`, and ordered `rows`. Each row preserves its original
`sourceIssueReference`, metadata-normalized `normalizedSeriesTitle`, `seriesYear`, `issueNumber`,
and any known exact `seriesId`, `candidateIssueId` or `originalIssueId`. Preserve an alias
explanation in the row rather than changing the original reference. Reuse accepted bibliography
and rows; do not type a neighboring issue to make a lookup succeed.

```powershell
$request = Join-Path $work 'request.json'
npm run owner:prepare -- "--work=$work" "--request=$request"
```

The cache is the existing vendor cache format: a request-URL-hashed filename containing the real
URL, URL hash, status, retrieval time and original response body with its body digest. A selected
projection is not such a record. Preparation is offline and reuses the exact resolver. It does not
perform a fuzzy search, invent a series year, or turn an ambiguous match into a selected ID.

An explicit representative original must have recorded cover metadata before review. Without an
explicit choice, the proposal selects the first included original with cover metadata, or records
no artwork when none is supplied. Missing optional cover metadata does not discard an original or
invent a replacement image.

An unresolved trade or conflicting identity produces `needs-resolution`, preserving the input and
positions. For a known metadata gap, keep an explicit row `gap` using the existing source-gap
schema. File its separate gap Issue assigned to the owner and include that Issue in the gap's
sorted `evidenceSources`. The exact rows may then ship while gap positions remain in source,
packet and mapping provenance. Repeated originals retain explicit first-occurrence references.
Repeated missing originals use one canonical gap and explicit repeat positions; the factual source
also retains each gap occurrence's group and lookup evidence. Conflicting gap dispositions are
refused. An unresolved edition boundary still needs a real decision, not a fabricated metadata gap.

A complete proposal preserves a digest-named directory under `proposals` containing `proposal.json`
and an unapproved `approval-request.json`. The console names that request, and the work directory's
`proposal.json` points to the latest complete content. Re-preparing never overwrites an existing
review request or its original proposal.
Schema, public-input privacy and provenance checks run before authority is bound. The full current
library includes visible cards, generated children and retained hidden parents. Its public input
files are part of the same exact-byte preflight.

## Obtain one actual bounded review

Give the reviewer the exact proposal digest, source facts, original vector, gaps, proposed insertion
and complete relationship report. `approval-request.json` contains only the non-none pairs that
need individual decisions. Its identity, rationale and timestamp fields are null, and its decisions
are pending. It is not approval.

The actual reviewer supplies source, insertion and relationship authority, including every
non-none disposition's exact relationship, shared count and shared IDs. Each identity records
`authorityType` (`human` or `stronger-model`), `authorityIdentity`, `rationale` and `reviewedAt`.
Do not fill those fields to impersonate a reviewer or describe an agent decision as human review.
Exact duplicate lists have no approval path. Zero-shared-issue rows use the existing none policy;
it does not authorize any meaningful overlap.

```powershell
npm run owner:author -- "--work=$work" "--approval=$approval"
npm run owner:vendor -- "--work=$work"
npm run owner:check -- "--work=$work" --scope=targeted
```

Authoring rechecks the exact public bytes and current library, then writes the source, packet,
mapping, report, independent vector contract, checklist, source-manifest entry and owner
registration. It refuses to overwrite an existing guide or approval. Vendoring uses the selected
guide and unchanged genuine metadata bodies only. There is no automatic refresh or substitution
after review.

The shared unit and browser contracts compare the independent accepted vector with source,
Markdown, payload, preview, import and reload. They preserve prior reader facts, separate history
and synchronous separate-tab reader launch. A new registration also carries its actual
relationship authority, including reciprocal comparisons to older owner guides. Older approvals
are not re-signed or treated as authority for a new non-none pair.

## Validate and publish one guide

Finish the guide-specific maintained provenance paragraph and inspect the complete diff.
Run the proposed-public-file preflight below, then stage exactly the intended public files.
Full validation refuses unstaged changes or undeclared untracked files rather than claiming
to have tested a different candidate.

```powershell
npm run owner:check -- "--work=$work" --scope=full
```

This runs the ordinary repository gates and browser suite with structured native command receipts.
Arguments are passed without a shell, native exit codes are preserved, and stdout/stderr remain
in the private work directory. A failure stops the sequence. Repair with affected checks before
the final clean candidate run; do not repeatedly replay every full suite while editing.

Commit, run the final history publication gate, and open the normal single-guide pull request using
the repository template. Keep proposed release notes and saved-data compatibility in that PR.
Do not use the clock as permission to skip regression failure proofs, publication safeguards,
required hosted checks or the actual owner/app merge.

Record transitions that occur outside the tool, including real metadata/clarification waits:

```powershell
npm run owner:phase -- "--work=$work" --phase=publication --kind=active
npm run owner:phase -- "--work=$work" --phase=hosted-checks --kind=hosted-check-wait
npm run owner:phase -- "--work=$work" --phase=owner-merge-wait --kind=owner-or-app-wait
npm run owner:finish -- "--work=$work" "--pr=$prNumber"
```

Other phase names are `preparation`, `resolution`, `authority`, `authoring`, `validation` and
`repair`. Other kinds are `metadata-or-clarification-wait` and `unclassified`.
Phase labels describe declared work/wait intervals; command receipts measure execution.
Do not invent active time where only a gap between receipts is known.

Finish reads GitHub; it never requests a merge. It requires an actual merge event and the published
and merged commits' exact validated tree. `merge-timing.json` includes total elapsed seconds and phase/kind
breakdowns. Time before the first tool record stays included as unclassified time. Missing timing,
an open PR, a different tree, or 3,600 seconds or more cannot be reported as a successful sub-hour
delivery. Disclose pre-existing research/cache reuse and any external blocker alongside the result.

## Early publication preflight

[The provenance issue](https://github.com/raymond-nassar/recap-page/issues/736) addresses a different
question from preserving an original: whether every proposed public dependency is safe to publish.

Write a private declaration with `schemaVersion: 1` and a nonempty `files` array. Each file has its
repository-relative `path` and an explicit `dependencies` array, including when empty. Declare
every required dependency as another file. A JSON `publicDependencies` array or a path/hash/byte
artifact receipt must agree with that graph. Untracked files are read too.

```powershell
npm run publication:preflight -- "--files=$publicSet" "--output=$preflightReceipt"
npm run publication:preflight -- "--files=$publicSet" "--expect=$preflightReceipt"
```

The same detector, exact allowances and protected-root policy are used by the final publication
gate. Missing, unreadable, linked, outside, malformed or incomplete inputs fail closed. Binary
inputs are not reported clean. A clean receipt binds names, dependency edges, policy and exact raw
bytes, including line endings. A changed input needs a new preflight; a clean old receipt is not
approval for new bytes.

Self-contained public facts may preserve a private original's basename, SHA-256 and byte count,
without a `path` or a requirement to open the private original. The public projection has its own
hash. Never relabel a projection's digest as the original digest. Findings identify a pattern and
input without printing the private matched value.

CBH/CBRO approval and authoring boundaries also invoke this preflight before writes. The ordinary
history, surface and branch modes remain separate backstops:
`npm run publication` still scans reachable committed history. A successful early preflight never
replaces that scan.

A pending CBRO file transaction requires recovery before a fresh authoring attempt. Recovery must
not change the public inputs after their preflight and authority have already been checked.

## Troubleshooting

`needs-resolution` is actionable missing or ambiguous input, not a failed publication. Review the
private intake/proposal instead of starting a new clock. `failure.json` and native command receipts
explain unsuccessful stages without copying private values to shared console output.

If public facts or the library changed, prepare a new exact proposal and obtain the affected actual
authority. Never refresh only a hash or bless a stale approval. Keep original research and frozen
history unchanged. New guide additions use one registration and shared contracts; unrelated
program changes still need their own bounded integration decisions.
