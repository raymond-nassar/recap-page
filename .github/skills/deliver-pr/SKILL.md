---
name: deliver-pr
description: Prepare a pull request from completed implementation and review evidence using the repository template. Use when a request asks to create, update, validate, or hand off a pull request, including PR-ready delivery.
---

# Deliver pull request

## Goal

Prepare a truthful pull request record from completed implementation and review evidence. Do not
fabricate review, validation, compatibility, release-note, or issue-closing evidence.

## Flow

1. Consume the implementation and review evidence. Use the exact repository pull request template,
   preserve its headings, comments, checklist items and ordering, keep human checkboxes unchecked,
   and put the required plain-English summary first.
2. Record exact validation results, saved-data compatibility, proposed release notes when required,
   and the intended issue-closing relationship. Do not use a closing keyword unless that closure is
   intended.
3. In an active delivery only, use the existing
   [relocation](../../../scripts/relocate-anchors.mjs) or
   [conflict-resolution](../../../scripts/resolve-anchor-conflicts.mjs) helper when needed.
   Read its preview, authorize the exact digest before apply, and use the strict anchors checker
   as the acceptance authority. Read every claim-and-line pairing before blessing; never bless
   merely to clear a red result or perform standalone anchor housekeeping.
4. Treat commit, push, publication record, merge, auto-merge, and platform dispatch as external
   actions. Perform each only when requested. After a requested commit, record publication before
   pushing, with the exact revision and population.
5. Merge only with explicit authorization, an exact reviewed head, a current base, and all checks
   passed, including the separate CodeQL summary. PR-ready is not merge authorization.

## Evidence

Use the [pull request template](../../../.github/pull_request_template.md), the
[release bookkeeping](../../../GOVERNANCE.md#release-bookkeeping) policy, and the repository
[commit and pull request](../../../.github/copilot-instructions.md#commits-and-pull-requests)
guidance.

## Limits and stop behavior

Do not invent a review or make an external change without its exact authorization. Stop when
evidence, the requested action, head/base state, or required checks are incomplete. Return the
specific missing item and the bounded next action.
