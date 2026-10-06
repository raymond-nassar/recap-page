# Protected Google Play testing publication

The **Google Play testing release** workflow operates on an already qualified, signed and
sealed Android App Bundle. It never builds, signs, allocates a code, creates a Play app,
changes account permissions or publishes from a push, tag, merge or GitHub release event.
It rejects production tracks. Production eligibility and permission remain separate owner decisions.

This is maintainer tooling only. Readers still need no Recap Page account; their progress,
notes and backups are not uploaded. The app's storage origin, schema and runtime dependencies
are unchanged.

## Prerequisites

Follow the [coordinated release policy](RELEASING.md) and
[protected Android candidate procedure](ANDROID.md#protected-app-bundle-candidates).
Before a publishing operation:

1. Merge the reviewed publisher workflow into the default branch. GitHub cannot dispatch a new
   manual workflow before it exists there.
2. Select the exact merged application source. Merge its monotonic Android code reservation,
   run the separately approved candidate producer, retain its four-file packet, then merge
   the exact proposed seal without replacing later reservations.
3. Keep the packet's producing run and immutable GitHub artifact available. The publisher
   verifies their identities, successful first-attempt Candidate provenance and archive digest.
   A locally assembled JSON report, rehearsal or development APK is not a substitute.
4. Complete the owner's Play account, app-content, rights, service-use, privacy, signing,
   device and applicable testing requirements. The API requires an existing app with an initial
   Console upload and cannot perform required legal consents.
5. Confirm that there is no concurrent publisher and no pending Play Console work, including
   changes already ready to send for review. Console changes can discard an API edit, and an
   API commit can also submit pre-existing Console changes ready for review. The workflow
   serializes only its own runs; it cannot verify or promise isolation from that Console work.

The retained producer report is deliberately limited: synthetic native coverage is not physical
device, production signer, API 26 runtime or upgrade acceptance. An accepted API commit is not
proof that a release is available to users.

## Keyless authentication and protection

The owner creates and independently verifies the **existing** GitHub environment
`google-play-publishing` before using a protected mode. Do not let dispatch create an
unprotected environment implicitly.

Required protection:

- Only the exact `main` branch may deploy; no tag or wildcard policy.
- A directly listed human reviewer must approve the exact run.
- Administrator bypass is disabled.
- Same-owner manual approval follows the existing signing policy; an agent must not approve
  on the owner's behalf.

Use a dedicated Google Cloud service account with GitHub OIDC Workload Identity Federation.
Restrict its provider to the immutable repository and owner IDs, `refs/heads/main`, the exact
`.github/workflows/google-play-release.yml` workflow, the protected environment subject and
`workflow_dispatch`. Bind only `roles/iam.workloadIdentityUser` on that service account.
Do not give the workflow project Owner or Editor.

The publishing job uses the protected environment at job scope. GitHub's default `sub` therefore
identifies the environment, not the branch; use the separate `ref` claim to restrict the branch.
The provider condition should match the immutable `repository_id` and `repository_owner_id`,
`ref == 'refs/heads/main'`, the exact `workflow_ref` ending in
`raymond-nassar/recap-page/.github/workflows/google-play-release.yml@refs/heads/main`,
`environment == 'google-play-publishing'`, and `event_name == 'workflow_dispatch'`. Do not require
a branch-shaped `sub` for this job. GitHub can use immutable IDs in `sub` too, so do not assume a
fixed subject format. See GitHub's [OIDC claim reference](https://docs.github.com/en/actions/reference/security/oidc),
retrieved 2026-10-05.

If authentication fails with `The given credential is rejected by the attribute condition`, packet
validation and GitHub approval have already passed, but the Google provider rejected the OIDC
claims. Inspect its attribute mapping and condition, then compare them with the claims above. Correct
the provider configuration without removing any of these restrictions; changing the workflow cannot
correct a condition stored in Google Cloud.

Invite the account in Play Console for **Recap Page only**:

- View app information (read-only), including any implied app-quality read permission.
- Release apps to testing tracks.

Do not add Play Admin, financial, user-management, tester-management, listing or production
permissions for this workflow.

Configure these nonsecret environment variables:

| Variable | Value |
|---|---|
| `GOOGLE_PLAY_WORKLOAD_IDENTITY_PROVIDER` | Full `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER` resource |
| `GOOGLE_PLAY_SERVICE_ACCOUNT` | Dedicated app-scoped service-account email |
| `ANDROID_UPLOAD_CERT_SHA256` | The same independently approved public upload-certificate fingerprint used by the candidate producer |

Project numbers and IDs are different. Google provider resource names use the numeric project
number; `gcloud` commands that require a project ID must receive the actual ID, not a display name.
Inspect existing resources before repeating a partial setup. Run multi-command setup in a file
or child shell so fail-fast handling does not close an interactive terminal.

The pinned Google-maintained auth action creates a 15-minute access token with only the
`androidpublisher` OAuth scope. Credential-file generation and environment export are disabled.
There is no service-account JSON key, password or long-lived Google token in this workflow.
Keep account-private configuration out of public Issues and release records.

## Modes and normal inputs

Dispatch from `main`, once per intended operation. Reruns are refused.

| Mode | Google access and effect |
|---|---|
| `Validate` (default) | Reads GitHub provenance and validates the packet, source, ledger and actual AAB signature. No Google credentials or Play API calls. |
| `Inspect` | Requires protected approval. Creates one working edit and reads tracks, bundles and APKs. Does not upload, change releases, validate/commit or delete the edit. |
| `Publish` | Requires protected approval. Uploads the exact retained AAB once, verifies returned code/hash, sets the approved testing target, checks all tracks and commits once. |
| `Promote` | Requires protected approval. Reuses a matching code/hash already present in Play; never uploads or rebuilds the bundle. |

The normal new-version operation supplies four values:

| Input | Normal Publish value |
|---|---|
| `mode` | `Publish` |
| `candidate_run_id` | One successful Candidate run ID, or its exact `https://github.com/raymond-nassar/recap-page/actions/runs/RUN_ID` URL |
| `track` | The actual existing testing track identifier, not a guessed alias |
| `release_notes` | Reviewed plain notes for this version, at most 500 Unicode code points |

The publisher derives the exact packet artifact, source, code and public signer from that
named successful main/direct/first-attempt producer, its original verified packet and the
sealed ledger at the executing workflow revision. It does not choose the latest artifact.
Discovery requires one canonical Candidate packet in a complete list of at most 100 artifacts;
missing, duplicate, ambiguous, truncated, expired or wrong-producer evidence fails. An expired
competing packet cannot be ignored to make selection unique. Current main is checked for intact
history and seals, not used to retarget the approved source.

Plain notes generate the release name `Recap Page PRODUCT_VERSION` from the verified application
source, its one resolved version code, status `completed` and language `en-US`. The visible
`track_state_policy` defaults to `automatic`, which selects `capture-current-simple` for this
normal path. It captures and checks the actual simple target state inside the approved Publish
edit. A separate Inspect or Validate run is not required.

`Validate` needs only its mode and named producer for packet checks. Adding track and release
intent previews the same normalized operation without Google access. `Inspect` is optional
discovery or reconciliation: after approval it returns actual non-production track identifiers,
current digests and code high-water. Do not assume an `internal` alias. Inspection creates an
edit, so coordinate it with Console work too.

## Advanced compatible inputs

The optional identity fields `source_sha`, `ledger_sha`, `artifact_id`, `version_code` and
`upload_cert_sha256` must be supplied together or all omitted. Complete old callers retain their
explicit artifact lookup and existing ledger ancestry checks; every pin must match independent
packet, source, seal, approval and signature evidence. These fields remain visible, but are not
needed for normal publication. They are identifiers, not credentials.

Use `release_json` instead of plain notes for a custom name, `draft` status, retained codes or
multiple languages. Never supply both release forms. `expected_track_sha256` supplies the exact
previous target digest when an explicit pin is required.

| Release intent | State policy |
|---|---|
| Candidate-only Validate or Inspect, with no release or digest | Neutral `automatic` resolves to no transaction policy; explicit transaction policies are rejected. |
| Publish or Validate preview with plain notes, no digest | `automatic` resolves to `capture-current-simple`, with either derived or complete identity pins. |
| Complete release form and valid digest | `automatic` resolves to `explicit-pin`. |
| Full JSON without a digest | Rejected under `automatic`; explicitly select `capture-current-simple` only for a supported new-version Publish or its Validate preview. |
| Explicit `capture-current-simple` plus any digest | Rejected as conflicting intent. |
| Promote, with either complete release form | A valid digest and `explicit-pin` are required; `automatic` with a digest resolves to that policy. Capture is never allowed. |

An explicit pin must still match the actual target when the edit begins. Identity lookup form
does not change release-state policy. Inspect accepts neither release intent nor a digest.

Example shape only; placeholders are not a reservation or authorization:

```json
{
  "name": "Recap Page PRODUCT_VERSION",
  "versionCodes": ["SEALED_VERSION_CODE"],
  "status": "completed",
  "releaseNotes": [
    {
      "language": "en-US",
      "text": "Reviewed release notes for this exact version."
    }
  ]
}
```

Only `draft` and `completed` are supported. The JSON input is bounded to 8 KiB, with notes limited
to 500 Unicode code points per language. Whitespace-only inputs are invalid.
The candidate code must appear exactly once; any other retained code must already
belong to the selected target track. This is an explicit replacement, not an inferred merge.
Multiple active releases, rollouts, country targeting or non-default update priority require
operator reconciliation rather than a guessed transformation.

Review the preflight's exact source, artifact hash, signer, track, resolved state policy and requested release
before approving. After approval, the workflow downloads and verifies the packet again,
requires the unchanged binding/policy and checks the actual current-run human approval before
obtaining a Google token. It rechecks protection and the current sealed ledger immediately
before the operation.

Track digests ignore object-key order, version-code set order, note-language order and an
explicit default update priority of zero. They do not trim copy, guess retained codes, drop
unknown fields or erase non-default rollout/targeting intent.

## Transaction and outcomes

The publisher sends no listing change and verifies that every non-target track remains unchanged
in its edit. It checks the selected target, rejects reused/out-of-order upload codes across all
tracks, bundles and APKs, compares the upload's returned SHA-256 and code, reads back all tracks,
and server-validates before committing.

Capture permits only an empty target or one draft/completed release without rollout, country
targeting or non-default priority. Before upload, the durable receipt records the resolved policy,
strict normalized actual target, its digest and the desired target. Failure to persist that
evidence stops upload. The approved intent is not rewritten to insert a newly captured digest.
Explicit pinning retains exact digest equality and the same simple-track restrictions.

Commit always sets `changesInReviewBehavior=ERROR_IF_IN_REVIEW`. Google's cancellation default
is not used. No failed request changes this flag automatically. This does not isolate the commit
from Console changes already ready for review. Do not publish with pending Console work or a
concurrent publisher, and do not interpret acknowledgement as immediate tester availability.

The retained `google-play-RUN_ID-ATTEMPT` artifact contains only a sanitized operation receipt,
not the token, account configuration, bundle, raw server response or full native logs.
Attempted stages are written before requests. Mutations are sent once without automatic retries.

| Outcome | Meaning |
|---|---|
| Validation completed | Packet/source checks passed; Google access and user availability remain unverified. |
| `inspected-no-release-change` | Readback is available; the temporary edit is left uncommitted. |
| `submitted-publication-unverified` | Commit acknowledgement matched the edit. Review, managed publishing and actual user availability remain separate. |
| `blocked` | A prerequisite or known request rejection stopped the operation. Read its stage/code before deciding a next action. |
| `uncertain` | A mutating request may have reached Google without a trustworthy result. Inspect Console before any new dispatch or allocation. |

Do not rerun or rebuild merely because a job is red. Retain its edit/stage/code/hash facts.
The workflow does not delete edits, cancel another review, waive a first upload, change
managed-publishing settings or claim production delivery.

## Normal release operations

The reviewed reservation merge and exact seal merge remain separate. Normal Android delivery
still needs two human credential approvals: Candidate signing, then exact-packet Play publication.
There is no automatic ledger merge or privileged release broker.

| Normal supplied values or approvals | Previously | Now |
|---|---|---|
| Candidate inputs | 6 | 4: mode, reserved code, observed high-water and public evidence |
| Play Publish inputs | 10 | 4: mode, named Candidate, actual track and plain notes |
| Native CI rehearsal inputs | 3 | 1: native mode |
| Routine Android environment approvals | 3, including separate Inspect | 2: signing and publishing |

Compatibility fields remain visible; these counts describe normal supplied values, not total
form fields. Separate Inspect remains available when actual track discovery or reconciliation
is needed. A manual Console fallback is an owner decision, not a failed workflow retry: first
reconcile any attempted upload/commit, then retain the exact sealed bytes, code and qualification.
Never rebuild, re-sign or silently replace the approved packet.

## GitHub Android downloads and production

The upload key is not Google's installed-app signing key. An upload-key-signed or disposable
test APK cannot be advertised as an update to a Play-installed app.

For a compatible GitHub download, obtain and independently qualify the Play-signed universal APK
for the exact uploaded code through the Console or supported generated-APK API. That operation,
its artifact record and distribution approval are separate from this uploader.

Production also requires app-specific eligibility, the applicable testing/access process,
owner product/privacy/device acceptance and a separately reviewed production-permission path.
Neither testing access nor a successful GitHub workflow grants those.

## References

Official documentation checked 2026-10-05:

- [Google Play API setup](https://developers.google.com/android-publisher/getting_started)
- [Keyless deployment authentication](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)
- [Play edit lifecycle and initial upload boundary](https://developers.google.com/android-publisher/edits)
- [Bundle identity and upload](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.bundles)
- [Track intent and release fields](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks)
- [Commit and existing-review protection](https://developers.google.com/android-publisher/api-ref/rest/v3/edits/commit)
- [Concurrent edits and pending Console changes](https://developers.google.com/android-publisher/concurrency-considerations), checked 2026-10-06
