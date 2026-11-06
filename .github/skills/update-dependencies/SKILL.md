---
name: update-dependencies
description: Update one requested dependency or pinned action with source, integrity, and test evidence. Use when a request asks to update an npm package, lockfile entry, Dependabot item, or GitHub Actions pin.
---

# Update dependencies

## Goal

Deliver one requested dependency update with evidence for its source, integrity, synchronized pins
or checksums, and relevant tests. Do not perform blanket updates.

## Flow

1. Classify the requested item as an npm package, GitHub Action, or another pinned dependency.
2. Confirm the upstream release tag, immutable SHA where applicable, and release notes. Preserve
   full action pins.
3. For npm updates, use the package manager so the lockfile remains coherent. Keep deliberate
   synchronized pins, checksums, and tests aligned. Do not silently defer a requested Dependabot
   update or weaken tests.
4. Keep browser runtime dependencies at zero. Use development scratch space outside the repository
   when tooling is required.
5. Report the exact update, evidence, validation result, compatibility effect, and any remaining
   authorization boundary. Merge needs explicit authorization; do not perform account or secret
   actions.

## Evidence

Use the [Dependencies](../../../CONTRIBUTING.md#dependencies) policy and
[Review pinned GitHub Actions](../../../docs/MAINTAINING.md#review-pinned-github-actions) for
workflow actions.

## Limits and stop behavior

Do not update unrelated packages, replace a full action SHA with a tag, weaken checks, or merge
without authorization. Stop when the requested release source, immutable identity, lock integrity,
or required validation evidence is unavailable.
