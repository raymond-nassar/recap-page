---
description: "Apply the local UI contract and record evidence for app markup, styles, and interactions."
applyTo: "src/**/*.html,src/**/*.css,src/**/*.js"
---

# UI implementation workflow

Deliver the requested UI behavior with the existing patterns and observable acceptance evidence.
The [Interface design contract](../../CONTRIBUTING.md#interface-design) owns the design rules.
Read it before editing; this file routes the work rather than defining another design standard.

## Before editing

Record a bounded matrix in the task's existing working record or pull request:

- Affected control or journey and the relevant contract requirement.
- Applicable states and transitions, including failure, empty, cancel and save outcomes where relevant.
- Shared pattern to reuse and the smallest existing unit, static or real-browser owner for each claim.
- Required manual or native-environment observations, with an expected result for each.

## Implement and verify

Start with the contract's local pattern/check map. Extend those owners when a changed behavior
lacks coverage instead of adding a parallel helper or checking for policy words.
Exercise the selected transitions and direct compatibility contracts, not just the default screen.
Follow [the checks](../../CONTRIBUTING.md#the-checks) and
[failure-before-fix proof](../../CONTRIBUTING.md#tests); targeted checks do not waive final gates.

## Report evidence honestly

Complete the UI entries in the [PR template](../PULL_REQUEST_TEMPLATE.md) with exercised
states, exact commands and results, and browser/manual observations. If a required check cannot
run, record what is missing, why, and the exact rerun condition; leave that claim unverified.
Record proposed exceptions, their reasons and evidence for maintainer disposition instead of
silently weakening a rule or gate. Separate automated, browser, simulated and human evidence.
A screenshot or passing static check does not establish keyboard, native assistive-technology
or external-reader behavior. Leave human acceptance unclaimed unless the maintainer has supplied
the result.
