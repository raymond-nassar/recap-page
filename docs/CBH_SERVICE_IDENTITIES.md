# Service-only comics in Comic Book Herald packets

This is an additive build-time identity option in the [Comic Book Herald packet
procedure](MAINTAINING.md#build-a-comic-book-herald-packet), not permission to publish a guide.
Source review, current pairwise relationship reports, approval digests and publication preflight
remain required. Existing provider-only packets keep their digest meaning.

For a separately verified exact comic with a Marvel Comics app viewer but no provider binding,
the frozen row and its mapping carry the same `serviceIdentity` object:

- `appViewer`: the viewer number as a string.
- `url`: its canonical `https://www.marvelcomicsapp.com/viewer/` address.
- `providerIssueId`: explicitly `null`.
- `normalizedSeriesTitle`, `seriesYear`, `issueNumber`: the independently reviewed exact source
  identity. The row must have the same values.
- `evidenceSha256`: the SHA-256 of the retained independent identity evidence.

The row has `seriesId: null` and `candidateIssueId: null`, no selected provider ID or Marvel issue
URL, and no provider candidate or selection array entries. A service series number is not a
provider series ID. The mapping uses `resolutionStatus: "exact"` and a factual
`resolvedIssueTitle`. `cbh:prepare` carries the frozen identity directly into the mapping without
requesting a provider series for it. Refresh cannot carry prior approval onto changed evidence.

A previously open source gap uses an `exact-service-issue` resolution with the same
`serviceIdentity`, the existing previous/resolved source identity fields, checked date, audit
basis, evidence sources and resolution digest. Its evidence sources must include a
`service-viewer` entry naming the canonical viewer URL. New evidence changes the packet and
mapping digests and requires fresh review. It never rewrites historical receipts.

The build derives the tracking key with the existing tagged-viewer helper. It never stores the
bare viewer number as `selectedIssueId`. Overlap reports compare that derived key, and the
checklist contains one canonical viewer link per actual comic. The existing checklist parser
produces the tagged record. Offline vendoring excludes it from provider requests and leaves
provider-only facts, availability and covers absent rather than inventing them.

A provider comic numbered 21710 and a service comic at viewer 21710 are distinct identities.
If another published guide still holds an old placeholder for a service comic, handling that
historical alias remains a separate compatibility decision and implementation. This build-side
option does not reconcile saves, authorize aliases or activate event payloads.
