---
name: prepare-release
description: Classify and prepare a product or platform release using the repository's release runbooks. Use when asked to plan, validate, package, or prepare a release, not to perform an unapproved publication action.
---

# Prepare release

Prepare a release decision and handoff without crossing an approval or publication boundary.
Keep product version, platform build identity, release channel, and publication approval distinct.

## Classify the request

Establish the release intent before choosing a procedure:

1. Is this preparation or publication?
2. Is a product-version change requested, and what compatibility decision supports it?
3. Which platform and channel are affected?
4. Which artifact ledger, build identity, review, and owner approval apply?

Use `docs/RELEASING.md` for shared release decisions, platform/version separation, and coordinated
release policy. `docs/RELEASING.md:7-31` Use `docs/MAINTAINING.md` for the general release-cutting
checklist. `docs/MAINTAINING.md:1037-1043`

## Route platform-specific work

Do not turn these routes into one universal command sequence:

| Platform or channel | Authoritative route |
|---|---|
| Android build allocation or candidate | [Android release contract](../../../docs/RELEASING.md#android-allocation-and-exact-artifact-contract) and [Android candidate procedure](../../../docs/ANDROID.md#protected-app-bundle-candidates). `docs/RELEASING.md:35-60`; `docs/ANDROID.md:239-246` |
| Google Play testing or promotion | [Protected Google Play publication](../../../docs/GOOGLE_PLAY_PUBLISHING.md). `docs/RELEASING.md:205-215`; `docs/GOOGLE_PLAY_PUBLISHING.md:1-20` `docs/GOOGLE_PLAY_PUBLISHING.md:256-295` |
| iOS build allocation, TestFlight export, or upload | [iOS release contract](../../../docs/RELEASING.md#ios-allocation-and-exact-artifact-contract) and [TestFlight procedure](../../../docs/IOS.md#signing-and-internal-testflight). `docs/RELEASING.md:257-284`; `docs/IOS.md:416-425` `docs/IOS.md:457-489` |
| Windows portable or MSIX proof | [Windows package proof](../../../docs/MICROSOFT_STORE.md#build-controlled-proof-packages). `docs/MICROSOFT_STORE.md:245-304` |
| Microsoft Store handoff, submission, or live review | [Store submission handoff](../../../docs/MICROSOFT_STORE_SUBMISSION.md#final-upload-handoff) and [live-review stop points](../../../docs/MICROSOFT_STORE_SUBMISSION.md#live-review-stop-points). `docs/MICROSOFT_STORE_SUBMISSION.md:457-491` `docs/MICROSOFT_STORE_SUBMISSION.md:493-515`; `docs/RELEASING.md:190-198` |

Preserve each platform's independent version or artifact ledger, exact-artifact checks, channel,
and protected approval boundary. A successful build, artifact, upload, or request does not prove
publication or user availability. `docs/RELEASING.md:225-238`

## Preparation boundary

Preparation may identify prerequisites, assemble records, and route the work. It must not handle
secrets or independently dispatch workflows, approve protected environments, upload, submit,
publish, merge, or make another externally visible or owner-gated change. Stop and obtain explicit,
action-specific authorization before any such action. `docs/RELEASING.md:99-102`
`docs/RELEASING.md:192-198` `docs/RELEASING.md:205-215`;
`docs/IOS.md:457-489`

After an uncertain release, upload, submission, or other mutation, inspect the authoritative
external state before taking another action. Never retry by guess.
`docs/RELEASING.md:99-102` `docs/RELEASING.md:308-314`
`docs/IOS.md:477-481` `docs/GOOGLE_PLAY_PUBLISHING.md:250`
`docs/MICROSOFT_STORE_SUBMISSION.md:548-550`

## Completion

Report the classification, governing runbook, platform/channel, version and artifact ledger
boundary, required approvals, preparation status, and the next authorized action. State clearly
when the request is publication rather than preparation and remains outside this skill's authority.
