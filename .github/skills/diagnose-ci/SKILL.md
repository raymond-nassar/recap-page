---
name: diagnose-ci
description: Diagnose a failed, cancelled, missing, or incomplete GitHub Actions run without changing it. Use when a request asks why CI failed, timed out, was superseded, lacks logs, has runner scarcity, or has no run.
---

# Diagnose CI

## Goal

Return a read-only diagnosis that distinguishes a real job or test failure from a superseded run,
timeout, runner scarcity, missing logs, or a missing run. Do not change CI to make a failed run
green.

## Flow

1. Identify the requested run and its head revision. If no run exists, check whether a run was
   expected for that event before proposing the documented manual dispatch route.
2. Read every job conclusion and the available job evidence. Inspect the separate CodeQL summary
   as well as Analyze, and distinguish job cancellation from a failing step or test.
3. Check for supersession, timeout evidence, runner-acquisition scarcity, and unavailable or
   missing logs. Treat protected publication and release workflows as separate from ordinary CI.
4. Return the run and head, job conclusions, evidence found, and one bounded next action. An
   ordinary retry needs explicit user authorization and the runbook criteria. Never blindly rerun
   a protected publication workflow.

## Evidence

Use the repository's [Reading CI honestly](../../../.github/copilot-instructions.md#reading-ci-honestly)
guidance. Preserve unavailable evidence as unavailable rather than inferring a cause.

## Limits and stop behavior

This skill is read-only by default. Stop when the available evidence cannot distinguish the cause,
when a retry lacks explicit authorization, or when the run is protected. State the authorization
gap or the exact missing evidence.
