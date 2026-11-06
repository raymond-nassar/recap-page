---
name: verify-ui-change
description: Verify a user-interface change with the smallest relevant desktop and Android checks. Use when a request asks to validate app markup, styles, interaction, browser behavior, or Android presentation without implementing the change.
---

# Verify UI change

## Goal

Produce truthful verification evidence for a completed UI change. This is a verification skill, not
an implementation skill.

## Flow

1. Select the smallest relevant desktop and Android owners from the existing UI contract and
   runbooks. Name the affected states, transitions, and direct compatibility contracts first.
2. Use the external scratch browser driver. Do not install browser tooling or other dependencies
   inside the repository.
3. Run only the selected owners' targeted checks while iterating. Run the full browser suite or
   full `npm test` only when the change's reach or the governing runbook requires it, once on the
   stable candidate, and one at a time. Serialize Android checks and asset invocations that
   regenerate the shared Android asset directory.
4. When mutation proof is appropriate, use no more than three mutations by default, with each
   mutation aimed only at its matching scenario.
5. Separate automated, real-browser, manual, and native evidence. Record missing manual or native
   observations honestly; local simulation is not native success.

## Evidence

Follow the [Interface design](../../../CONTRIBUTING.md#interface-design) contract and the
[maintainer browser checks](../../../docs/MAINTAINING.md#run-the-browser-check). Report the exact
owner, command, scenario, result, revision, and limitation for each claim.

## Limits and stop behavior

Outside approved temporary mutation proof, do not edit product code or tests. Do not change
dependencies or browser setup. Stop when the relevant owner,
external driver, manual observation, or native environment is unavailable, and name the exact
rerun condition.
