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
5. Confirm that no one is changing this app in Play Console or running another publishing
   client. Console changes can discard an API edit. The workflow serializes only its own runs.

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

## Modes and explicit inputs

Dispatch from `main`, once per intended operation. Reruns are refused.

| Mode | Google access and effect |
|---|---|
| `Validate` (default) | Reads GitHub provenance and validates the packet, source, ledger and actual AAB signature. No Google credentials or Play API calls. |
| `Inspect` | Requires protected approval. Creates one working edit and reads tracks, bundles and APKs. Does not upload, change releases, validate/commit or delete the edit. |
| `Publish` | Requires protected approval. Uploads the exact retained AAB once, verifies returned code/hash, then changes only the approved testing track and commits once. |
| `Promote` | Requires protected approval. Reuses a matching code/hash already present in Play; never uploads or rebuilds the bundle. |

Every mode requires the exact application source SHA, later sealed-ledger SHA, producing
Candidate run ID, immutable artifact ID, version code and approved public upload-certificate
SHA-256. These are identifiers, not credentials.

`Inspect` returns the actual non-production track identifiers, each current track digest and
the observed code high-water in its receipt. Do not assume an `internal` alias: use the exact
identifier returned for the intended app. Inspection itself creates an edit, so coordinate it
with other Console work.

`Publish` and `Promote` additionally require:

- `track`: the existing testing track's exact identifier.
- `expected_track_sha256`: its digest from the inspected state.
- `release_json`: the complete desired simple release, including explicitly retained codes.

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
to 500 Unicode characters per language. The candidate code must appear exactly once; any other retained code must already
belong to the selected target track. This is an explicit replacement, not an inferred merge.
Multiple active releases, rollouts, country targeting or non-default update priority require
operator reconciliation rather than a guessed transformation.

Review the preflight's exact source, artifact hash, signer, track state and requested release
before approving. After approval, the workflow downloads and verifies the packet again,
requires the unchanged binding/policy and checks the actual current-run human approval before
obtaining a Google token. It rechecks protection and the current sealed ledger immediately
before the operation.

Track digests ignore object-key order, version-code set order, note-language order and an
explicit default update priority of zero. They do not trim copy, guess retained codes, drop
unknown fields or erase non-default rollout/targeting intent.

## Transaction and outcomes

The publisher never modifies another track or Store listing. It checks the selected target
state, rejects reused/out-of-order upload codes, compares the upload's returned SHA-256 and code,
reads back all tracks, and server-validates before committing.

Commit always sets `changesInReviewBehavior=ERROR_IF_IN_REVIEW`. Google's cancellation default
is not used. No failed request changes this flag automatically.

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
