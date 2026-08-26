# UX Study: Marvel Reading Tracker

A single-rater study of the shipped application, run as the UX half of a product backlog and UX
study pass. Every claim below carries an evidence anchor. Anchors take the form `path:START-END`
for a claim about specific lines, `path` alone for a claim that a file exists, and
`absent: pattern, method` for a claim that something is missing.

Raw tool output and screenshots live in `docs/ux-artifacts/` and are left uncommitted.

## Scope and method

The study covers the whole application rather than a named focus area. It ran in four layers, in
the order the layers appear below, so that the three static layers were complete before the
application was started.

`live` resolved to `true`, but not through the route the method assumed. The chat browser tools
this method expects were not available in this environment, which is rung 2 of the degradation
ladder. Rather than descend to a code-only audit, the run escalated: `pa11y` was invoked through
`npx --yes` because it bundles its own browser, and Puppeteer was installed into a scratch
directory outside the repository so that live inspection, axe injection, viewport sweeps and
preference emulation could all still run. The substitution and everything it did not cover are
recorded in Coverage and Limitations at the end of this study.

The audit ran against `http://127.0.0.1:8899/`, a deliberately separate origin from the
load-bearing `127.0.0.1:8787`, so that the study never touched real reading progress. That origin
starts empty, so it was seeded by importing the House of M list, 20 issues resolved from local
data with no network call, and marking issues read. The 219 issue Hickman full list was
substituted only for the performance probe.

### How to read the findings

Severity is Nielsen's 0 to 4 scale and is a single-rater estimate throughout.

Confidence is one of `Observed`, `Measured`, `Inferred`, `Assumption`, or `Verified absent`.
`Measured` means the claim rests on output from a named tool run rather than on reading source, so
a computed contrast ratio or an axe result is `Measured` and never `Observed`.

Nielsen documents single-evaluator severity ratings as too unreliable to trust and recommends
three to five independent evaluators. One evaluator produced every rating here, so they need human
confirmation before they are used to settle an argument. The mitigation applied was to run three
separate passes with different framings, code only, live UI at 1280 pixels, and mobile viewport at
320 and 390 pixels, and to note where the framings disagreed. Where a finding surfaced in only one
framing, its Source line says so.

## Step 1: Heuristic evaluation

Evaluated against all ten of Nielsen's usability heuristics, named by their standard titles.

| # | Heuristic | Severity | Verdict |
|---|-----------|----------|---------|
| 1 | Visibility of system status | 2 | Status is communicated well in words, but the interface stalls visibly on a long list. UX-H-001 |
| 2 | Match between the system and the real world | 1 | Strong. Labels are written in reader language, and availability wording hedges rather than promises. `src/js/main.js:2845-2850` |
| 3 | User control and freedom | 3 | Restoring a backup could be undone, deleting a list could not. Closed by BL-035. UX-H-003 |
| 4 | Consistency and standards | 3 | Two different error and prompt systems run side by side. UX-H-002 |
| 5 | Error prevention | 1 | Strong. Unreadable saved data pauses writing rather than overwriting, and a future schema is refused. `src/index.html:112-127`, `src/js/lib/model.js:888-964` |
| 6 | Recognition rather than recall | 2 | The one keyboard shortcut the interface advertises is documented only at the point of use. UX-H-004 |
| 7 | Flexibility and efficiency of use | 2 | Only two shortcuts exist and one silently stops working. UX-D-003 |
| 8 | Aesthetic and minimalist design | 1 | Restrained by design, though each row carries six controls that are hidden until hover. UX-A-005 |
| 9 | Help users recognize, diagnose, and recover from errors | 1 | Strong where it matters most. The unreadable-data banner explains the cause, preserves the original, and offers a salvage download. `src/index.html:112-127` |
| 10 | Help and documentation | 2 | An About view and a thorough README, but no in-app reference for shortcuts or filters. `src/index.html:42-87` |

#### UX-H-001: A single read toggle re-renders the entire application

Surface: reading view with the 219 issue Hickman full list open, 1280 pixels
Heuristic: 1, Visibility of system status
Severity: 2, single-rater estimate
Rationale: occurs on the single most repeated action in the product, persists for the life of the
list, and grows with list length, but degrades speed rather than blocking the task
Confidence: Measured
Evidence: `docs/ux-artifacts/render-cost.json`, `src/js/main.js:91-96`, `src/js/main.js:5149-5169`
Source: live UI framing, reacted to the store wiring while reading `src/js/main.js`
Impact: marking one issue read rebuilds the rail, all 219 rows and the progress block, which is
4,485 DOM nodes and 1,533 row controls, at a median of 21.9 ms synchronous and 75.7 ms to paint,
with the first toggle costing 38.9 ms and 144.1 ms. Measured headless on a desktop machine, so a
phone will be slower. The list also renders in full while the containing details element is
closed, so the cost is paid even when nothing is visible.
Recommendation: update only the row that changed and the counters that depend on it, and skip
rendering rows while their container is collapsed
Backlog item: BL-033

#### UX-H-002: Native browser dialogs run alongside the in-page notice system

Surface: curated import, list rename, list delete
Heuristic: 4, Consistency and standards
Severity: 3, single-rater estimate
Rationale: affects several primary flows, is permanent rather than transient, and splits the
product's voice in two at exactly the moments a reader is deciding something
Confidence: Observed
Evidence: `src/js/main.js:4417`, `src/js/main.js:2120-2128`, `src/js/main.js:2147-2163`, against
`src/js/main.js:567-588`
Source: heuristic 4 sweep, code-only framing
Impact: the application has a careful in-page notice system with live regions, and then reports
curated import failures through `alert()`, asks for a list name through `prompt()`, and confirms
deletion through `confirm()`. Native dialogs cannot be styled, are not announced through the
application's own live regions, block the page, and on some browsers can be suppressed entirely,
in which case a rename silently does nothing.
Recommendation: move naming and confirmation into the page using the existing notice and dialog
patterns, and route import failures through `notify()` like every other path
Backlog item: BL-034
Resolved: naming and confirmation moved into one `<dialog>` at `src/js/ask.js:56-100`, and the
three `alert()` calls in `importCurated` now write to a pane the caller names. The Evidence
anchors name the code as it now stands; the Impact above describes the native dialogs it
replaced. The suppression case in particular is closed: a browser that blocks dialogs can no
longer turn a rename into silence, because there is no native dialog left to block.

#### UX-H-003: Deleting a list cannot be undone, while restoring a backup can

Surface: list tools in the reading view
Heuristic: 3, User control and freedom
Severity: 3, single-rater estimate
Rationale: irreversible, affects data the reader curated by hand, and the inconsistency with
restore makes the gap harder to anticipate
Confidence: Observed
Evidence: `src/js/main.js:2147-2163`, `src/js/main.js:4799-4805`
Source: heuristic 3 sweep, code-only framing
Impact: deletion is guarded only by a native `confirm()` and there is no undo afterwards. Read
progress survives, because it is global, but the list name and its curated order do not. Restoring
a backup, which is arguably less destructive, does have an undo, so the reader has no consistent
model of what is recoverable.
Recommendation: offer an undo after deletion for the rest of the session, matching the restore
affordance that already exists
Backlog item: BL-035
Partly overtaken: BL-034 replaced the native `confirm()` with the app's own dialog, so the guard
named in the Impact above is now in-page. The finding itself stands, because a confirmation is
not an undo and the deletion is still irreversible once answered.
Resolved: BL-035 shipped the undo. Deleting a list now offers "Undo delete" in the notice above
every view, held for the rest of the session rather than for a few seconds, and restoring puts the
list back at the position it held in the rail. The inconsistency with restore is gone.
Followed by BL-158, which left that hold alone and gave the reader the way out of it. Nothing
withdrew the message except taking the offer, so a delete the reader had finished with kept its
banner on every screen for as long as the tab stayed open, reported after hours of it. Every message
raised under that key now carries a "Dismiss" beside the offer, and taking it ends the undo as well
as the words.

#### UX-H-004: The advertised keyboard shortcut is documented only where it is used

Surface: hero call to action in the reading view
Heuristic: 6, Recognition rather than recall
Severity: 2, single-rater estimate
Rationale: affects repeat use rather than first use, and the cost is a slower path rather than a
blocked one
Confidence: Observed
Evidence: `src/index.html:297`, `src/js/main.js:2876-2899`
Source: heuristic 6 sweep, code-only framing
Impact: the hero button carries a `kbd` hint, so the shortcut is discoverable at that one spot and
nowhere else. There is no shortcut reference anywhere in the interface, so a reader who has
scrolled past the hero has no way to recall what is available.
Recommendation: add a short shortcut reference to the About view, and keep it as the single place
the list is maintained
Backlog item: BL-026
Resolved: BL-026 added the reference to the About view at `src/index.html:848-859`, covering Enter,
D and the sidebar toggle. The hero keeps its `kbd` hint, so the shortcut is still discoverable at
the point of use, but recall no longer depends on being scrolled to it.

## Step 2: Accessibility audit

Audited against WCAG 2.2 Level A and AA, which is 55 criteria, 31 at Level A and 24 at Level AA,
counted from the W3C recommendation. That count already excludes 4.1.1 Parsing, which WCAG 2.2
retired, and 4.1.1 results were filtered out of tool output without adjusting the count.

### What automated tools can and cannot settle

Deque's analysis of its own corpus found that automation caught 57.38 percent of accessibility
issues by volume, but only about 32 percent of WCAG 2.1 AA criteria by type. Focus order, focus
visible, keyboard traps, link purpose and status messages sit near zero percent automatable.

Tool output is therefore never a conformance verdict here. It is a starting set that the manual
pass either confirms, overturns, or carries forward. Two findings below exist only because the
manual pass overturned a tool result in each direction: 2.5.8 was reported as a failure by a naive
reading of element sizes and turned out to pass, and the hero contrast results were reported as
indeterminate and turned out to be a real design problem.

### Tool runs

| Run | Tool and version | Surface | Result | Artifact |
|-----|------------------|---------|--------|----------|
| 1 | axe-core 4.12.1, injected | Landing, first run, unseeded | 0 violations, 1 incomplete | `docs/ux-artifacts/axe-01-landing-firstrun.json` |
| 2 | axe-core 4.12.1, injected | Catalog, loaded | 1 violation over 8 nodes, 1 incomplete | `docs/ux-artifacts/axe-02-catalog-loaded.json` |
| 3 | axe-core 4.12.1, injected | Reading, seeded | 1 violation over 9 nodes, 1 incomplete over 26 nodes | `docs/ux-artifacts/axe-03-reading-seeded.json` |
| 4 | axe-core 4.12.1, injected | Progress, seeded | 0 violations, 1 incomplete | `docs/ux-artifacts/axe-04-progress-seeded.json` |
| 5 | pa11y, axe 4.11 and HTML_CodeSniffer runners | Landing, first run, unseeded | 4 errors | `docs/ux-artifacts/pa11y-landing.json` |
| 6 | pa11y, axe 4.11 and HTML_CodeSniffer runners | Reading, seeded | 27 errors | `docs/ux-artifacts/pa11y-reading-seeded.json` |
| 7 | Dependency-free contrast computation over the stylesheet tokens | All | 6 of 18 sampled pairs below 4.5:1 | `docs/ux-artifacts/contrast-audit.json` |

The two axe versions disagree, and the disagreement is informative rather than noise. Injected axe
4.12.1 reported 9 colour-contrast nodes on the seeded reading view as definite violations, while
pa11y's bundled axe 4.11 reported all 22 of its colour-contrast results on the same surface as
needing further review. Where they disagree, this study takes the HTML_CodeSniffer numbers as the
definite set, because that runner reports a computed ratio it can be checked against.

### axe incomplete results carried into the manual pass

Every one of pa11y's 22 axe colour-contrast results on the seeded reading view carries
`needsFurtherReview: true`, and axe 4.12.1 likewise reported 26 incomplete nodes there. These were
not dropped. The reason axe cannot decide is itself the finding: the hero renders a blurred cover
image behind its text, so no author-time contrast value exists, and the value changes with every
comic cover. That is recorded as UX-A-003.

### Sweep result

Of the 55 criteria, 4 fail, 39 pass, 6 are not applicable, and 6 could not be assessed with the
tooling available. Every non-pass is named below rather than left to a count.

Failures:

| Criterion | Level | Finding |
|-----------|-------|---------|
| 1.3.1 Info and Relationships | A | UX-A-007, an empty `h2` ships in the first-run DOM |
| 1.4.3 Contrast (Minimum) | AA | UX-A-001 and UX-A-002 |
| 1.4.10 Reflow | AA | UX-D-002, 93 pixels of horizontal overflow at 320 pixels |
| 1.4.11 Non-text Contrast | AA | UX-A-002, the read-row opacity also drops badge borders below 3:1 |

Not applicable, with reason:

* 1.2.1 through 1.2.5, all Level A and AA time-based media criteria, not applicable, because the
  application ships no audio and no video. Evidence: `absent: <video|<audio|\.mp4|\.webm, grep
  across src/`.
* 1.4.2 Audio Control, not applicable, for the same reason.
* 2.2.2 Pause, Stop, Hide, not applicable, because the only moving element is a progress ring
  transition that already respects reduced motion. Evidence: `src/styles.css:493`,
  `src/styles.css:1462-1464`.
* 3.3.8 Accessible Authentication (Minimum), not applicable, because there is no authentication of
  any kind. Evidence: `absent: password|login|signin|oauth|token, grep across src/`.
* 3.3.7 Redundant Entry, not applicable, because no flow asks for the same information twice.
* 2.5.4 Motion Actuation, not applicable, because no feature responds to device motion.

Could not be assessed, carried into Coverage and Limitations:

* 1.4.4 Resize Text and 1.4.12 Text Spacing, because both need a real browser zoom and
  user-stylesheet pass rather than a viewport resize.
* 2.4.11 Focus Not Obscured (Minimum), because the sticky rail and sticky hero would need a
  scrolled focus walk at several scroll offsets to settle.
* 1.4.13 Content on Hover or Focus, because the hover-revealed row actions need a pointer-hover
  dismissal test that the headless run did not perform.
* 4.1.2 Name, Role, Value for the availability badge, because its `title`-carried description needs
  a screen reader to confirm what is actually announced.
* 4.1.3 Status Messages, because the double announcement described in UX-A-006 needs a screen
  reader to confirm how it is voiced.

Notable passes, recorded because a reader would reasonably expect them to fail:

* 2.4.3 Focus Order and 2.4.7 Focus Visible pass. All 45 captured tab stops carry a 3 pixel solid
  outline, and focus order follows reading order. Evidence: `docs/ux-artifacts/live-inspection.json`,
  `src/styles.css:223-227`.
* 2.1.2 No Keyboard Trap passes. A reverse walk escaped to the document body.
  Evidence: `docs/ux-artifacts/live-inspection.json`.
* 2.5.8 Target Size (Minimum) passes, through the spacing exception rather than through size. This
  is detailed in UX-A-004 because the naive reading is a failure.
* 2.5.7 Dragging Movements passes, because reordering uses up and down buttons rather than drag.
  Evidence: `docs/ux-artifacts/live-inspection.json`.
* 3.2.2 On Input passes, overturning a tool result. HTML_CodeSniffer flagged `#form-catalog-search`
  under H32.2 for having no submit button on both scanned surfaces. The form is search-as-you-type
  and calls `preventDefault` on submit, results update in place, and no change of context occurs,
  so the criterion is met. Evidence: `src/index.html:411-417`, `src/js/main.js:4303-4312`.

#### UX-A-001: The primary call to action and the accent text fall below 4.5:1

Surface: hero call to action and eyebrow text, reading view, and the brand mark in the rail
Criterion: WCAG 2.2 1.4.3 Contrast (Minimum), Level AA
Severity: 3, single-rater estimate
Rationale: affects the single most prominent action in the product, on every reading surface, and
persists across every session and every list
Confidence: Measured
Evidence: `docs/ux-artifacts/pa11y-reading-seeded.json`, `docs/ux-artifacts/contrast-audit.json`,
`src/styles.css:104-110`, `src/index.html:297`
Source: WCAG 2.2 Level AA sweep, criterion 1.4.3
Impact: HTML_CodeSniffer computed `#btn-hero-read`, the Open in Marvel Unlimited button, at
4.36:1, its nested `kbd` hint at 4.36:1, the hero eyebrow paragraph at 4:1, and the rail brand mark
at 4.36:1, against a 4.5:1 requirement. The independent token computation agrees, putting white on
the red accent at 4.36:1 and the red accent on the page background at 4.33:1. The two methods
disagree on the `kbd` hint alone, which the token computation puts at 3.03:1 because it models the
75 percent white the stylesheet actually applies and HTML_CodeSniffer does not.
Recommendation: darken the red accent token until white text on it clears 4.5:1, and stop tinting
the `kbd` hint below full white, treating the accent as a token change rather than a per-component
fix
Backlog item: BL-029
Resolved: the single accent was split into `--red` for surfaces behind white text and
`--red-text` for red used as text, at `src/styles.css:104-110`, and the `kbd` tint was removed at
`src/styles.css:604`. BL-166 has since renamed both to `--accent` and `--accent-text` and repainted
them purple, so the split survives under different names. The figures in the Evidence artifacts are
the pre-fix measurements and are kept as the record of why the item was raised.

#### UX-A-002: Read rows are dimmed by a blanket opacity that pushes text to 2.34:1

Surface: reading view rows in the read state
Criterion: WCAG 2.2 1.4.3 Contrast (Minimum) and 1.4.11 Non-text Contrast, Level AA
Severity: 3, single-rater estimate
Rationale: applies to a growing majority of rows as the reader progresses, so the more the product
is used the more of it becomes hard to read
Confidence: Measured
Evidence: `docs/ux-artifacts/contrast-audit.json`,
`docs/ux-artifacts/axe-03-reading-seeded.json`
Source: WCAG 2.2 Level AA sweep, criterion 1.4.3
Impact: a single `opacity: .48` on the read row dims everything inside it uniformly, including
text that was already close to the floor. Computed results put the row meta text and the action
labels at 2.34:1 and the badge borders at 2.75:1. Injected axe 4.12.1 independently reported 9
definite colour-contrast nodes on this surface, the first of which is the meta text inside a read
row. This differs from UX-A-001, which is about the accent tokens themselves rather than a state
that multiplies them.
Recommendation: express the read state through a dedicated dimmer foreground token and a check
mark rather than through container opacity, so the state reads without dragging every child below
the contrast floor
Backlog item: BL-030
Resolved: the container `opacity` was replaced with a dedicated `--read-fg` foreground plus a
strikethrough, at `src/styles.css:729-730`. The only opacity left on a read row is on the cover
image at `src/styles.css:732`, which carries no text. Re-measured with six rows actually in the
read state, axe 4.13.0 reported no contrast violations on the surface.

#### UX-A-003: Hero text contrast is undeterminable because it sits on a blurred cover

Surface: hero, reading view
Criterion: WCAG 2.2 1.4.3 Contrast (Minimum), Level AA
Severity: 3, single-rater estimate
Rationale: affects the most prominent text in the product and cannot be fixed per comic, because
the backdrop changes with every cover the reader reaches
Confidence: Measured
Evidence: `docs/ux-artifacts/axe-03-reading-seeded.json`,
`docs/ux-artifacts/pa11y-reading-seeded.json`, `src/index.html:270-305`
Source: WCAG 2.2 Level AA sweep, criterion 1.4.3, carried from axe incomplete results
Impact: axe returned 26 incomplete nodes here and pa11y returned 22 colour-contrast results all
carrying `needsFurtherReview`. Both refuse to decide for the same reason: the hero paints a blurred
cover image behind the text, so there is no author-time background colour to measure against. The
indeterminacy is the finding. Contrast is not merely unknown to the tool, it genuinely varies from
comic to comic, so some covers will read and some will not, and no static check will ever catch
the bad ones.
Recommendation: place a solid or sufficiently opaque scrim between the cover and the text so the
computed background is fixed regardless of cover, which also makes the surface checkable
Backlog item: BL-031
Resolved as a side effect of BL-029: the hero scrim's top stop was raised from 60 to 88 percent
alpha at `src/styles.css:540-547`. Sampling the rendered background across all eight catalog
series narrowed the spread from `#222325`-`#2e2d30` to `#1b1d22`-`#1e2126`, and the computed
bound for a pure white cover is `#1f2228`, so the background is now fixed enough to check
against whatever the reader imports rather than varying comic to comic.

#### UX-A-004: Row controls are below 24 by 24 pixels but pass through the spacing exception

Surface: reading view row controls, 1280 pixels, seeded 20 issue list
Criterion: WCAG 2.2 2.5.8 Target Size (Minimum), Level AA
Severity: 2, single-rater estimate
Rationale: every row control on the primary reading path, persisting across sessions, but a
conformance pass and an ergonomic problem rather than a barrier
Confidence: Measured
Evidence: `docs/ux-artifacts/target-spacing.json`, `docs/ux-artifacts/live-inspection.json`,
`src/styles.css:744-747`
Source: WCAG 2.2 Level AA sweep, criterion 2.5.8
Impact: 60 of 140 row targets measure under 24 pixels in at least one dimension. The read toggle is
17 by 17 and the row action buttons are 22 by 26. The naive verdict is a failure, and it is wrong.
Measuring centre-to-centre distance to the nearest other target gives 69.3 pixels for the read
toggles and 26 pixels for the action buttons, both at or above the 24 pixel threshold, so the
spacing exception is met and the criterion passes. The action buttons clear it by 2 pixels, so any
future tightening of that gap turns a pass into a failure. The remaining problem is ergonomic
rather than formal: a 17 pixel target is well under the 44 pixel figure that platform guidance and
the AAA criterion 2.5.5 both use.
Recommendation: grow the hit area of the read toggle and the row actions using padding, keeping the
visual size if the density matters, and add a regression check on the 26 pixel gap
Backlog item: BL-028

#### UX-A-005: Row actions are invisible until hover, so a touch user cannot see them

Surface: reading view rows, all viewports
Criterion: WCAG 2.2 1.4.13 Content on Hover or Focus, Level AA, and heuristic 8
Severity: 3, single-rater estimate
Rationale: hides six controls per row on the primary reading path, on every touch device, for the
life of the product
Confidence: Measured
Evidence: `src/styles.css:801-802`, `docs/ux-artifacts/live-inspection.json`
Source: mobile viewport framing, criterion 1.4.13
Impact: the row action container computes to `opacity: 0` at rest and is revealed only on `:hover`
or `:focus-within`. Keyboard users are served, because the measured tab walk reached every action
button with a visible focus ring. Touch users are not, because a touch device has no hover state,
so the reorder, availability, marvel.com and remove controls are invisible until something else
reveals them. This differs from UX-A-004, which is about the size of those controls once visible.
Recommendation: reveal the row actions at rest on pointer-coarse devices and below the mobile
breakpoint, keeping the hover reveal only where a fine pointer is present
Backlog item: BL-028

#### UX-A-006: Status messages are announced twice

Surface: every in-page notice
Criterion: WCAG 2.2 4.1.3 Status Messages, Level AA
Severity: 2, single-rater estimate
Rationale: affects every notice in the product, and duplicate speech is disruptive rather than
blocking
Confidence: Observed
Evidence: `src/js/main.js:412-425`, `src/js/main.js:567-588`, `src/index.html:21`,
`src/index.html:102`, `src/index.html:550`
Source: WCAG 2.2 Level AA sweep, criterion 4.1.3
Impact: `notify()` writes its message into a container that already carries a live region role, and
then also calls `announce()`, which writes the same message into the dedicated `#announcer` live
region. A screen reader that honours both regions hears the message twice. The intent, making sure
nothing is missed, is right, but the effect is that every confirmation is spoken in duplicate.
Recommendation: pick one channel per message, keeping `announce()` for events with no visible
surface and letting the visible live region speak for itself everywhere else
Backlog item: BL-027
Resolved: which channel a message uses is now read off the container at `src/js/main.js:418-425`
rather than decided by a list of ids, and the six result panes stopped being live regions. The
Impact above describes the pre-fix behaviour and is kept as the record of why the item was
raised. Measured on a first run with storage cleared, the surfaces that speak went from 9 to 3.

#### UX-A-007: The first-run DOM ships an empty heading

Surface: landing, first run, unseeded
Criterion: WCAG 2.2 1.3.1 Info and Relationships, Level A
Severity: 2, single-rater estimate
Rationale: affects the very first screen a new install presents, though only until a list is
imported
Confidence: Measured
Evidence: `docs/ux-artifacts/pa11y-landing.json`, `src/index.html:270-305`
Source: WCAG 2.2 Level A sweep, criterion 1.3.1
Impact: HTML_CodeSniffer reported `#hero-title` under H42.2 on the unseeded landing page, because
the `h2` is present in the markup and empty until a list is loaded. A screen reader user browsing
by heading on a fresh install meets a heading with nothing in it, which advertises structure the
page does not yet have.
Recommendation: leave the heading out of the document until it has content, or give the empty state
a real heading, so the heading outline always describes what is actually on screen
Backlog item: BL-027
Resolved: the second option was taken, because `#chero-h` and `#hero-title` both name their own
section through `aria-labelledby`, so removing them would have cost those sections their names.
Re-measuring found three empty headings rather than the one this finding names: `#preview-h` and
`#chero-h` fail the same way and sit in containers that are hidden until used, which axe skips
and HTML_CodeSniffer does not. All three now carry text in the markup and are put back by their
render functions. Measured empty headings went from 3 to 0.

#### UX-A-008: The interface is locked to a dark scheme

Surface: whole application
Criterion: WCAG 2.2 1.4.3 Contrast (Minimum) adjacent, and inclusivity under ISO 25010 interaction
capability
Severity: 2, single-rater estimate
Rationale: affects every surface for the life of the product, and matters most to readers who need
a light or high-contrast presentation, but is a preference gap rather than a barrier
Confidence: Measured
Evidence: `src/styles.css:83`, `src/index.html:10`, `docs/ux-artifacts/live-inspection.json`
Source: live UI framing, preference emulation
Impact: `color-scheme` is hard-coded to dark and no `prefers-color-scheme` rule exists. Under
emulated light preference the computed body background stays `rgb(15, 17, 21)` and the screenshots
taken under light and dark preference are byte-identical, so the reader's system preference has no
effect at all. Forced colours and reduced motion are both handled, which shows the gap is a missing
theme rather than a general disregard for user preferences. Evidence for that contrast:
`src/styles.css:1462-1464`.
Recommendation: derive the palette from tokens and add a light theme behind `prefers-color-scheme`
with a manual override, reusing the existing forced-colors work as the model
Backlog item: BL-032

Resolved: BL-032 shipped all three parts. The evidence above is left describing the state that
prompted the finding, so its two citations are re-aimed rather than rewritten. Under an emulated
light preference the computed body background is now `rgb(251, 252, 254)` where it was
`rgb(15, 17, 21)`, and `color-scheme` is declared per theme rather than hard-coded, with the meta
tag carrying both values so the browser's own controls follow the preference from the first frame.
The manual override is a Theme control under Data offering system, dark and light. The forced-colors
work was indeed the model and is untouched: it uses system colour keywords only, so it is
palette-independent and still wins over both themes.

The screenshot pair that produced this finding is the direct measure of the fix. Captured the same
way, seeded the same way and at the same 1280 by 900 viewport,
`docs/ux-artifacts/06-reading-seeded-prefers-light.png` and
`docs/ux-artifacts/06-reading-seeded-prefers-dark.png` are byte-identical, which is what "no effect
at all" above means. Their successors
`docs/ux-artifacts/09-reading-seeded-prefers-light.png` and
`docs/ux-artifacts/09-reading-seeded-prefers-dark.png` are not. Layout is unchanged between the two,
so what differs is palette alone, which is the intended shape of the change rather than a reflow.
`docs/ux-artifacts/09-settings-theme-1280.png` shows the override control and
`docs/ux-artifacts/09-progress-seeded-prefers-light.png` a second surface under the light palette.

The palette gate that shipped alongside those recorded six boundaries below the 3:1 non-text floor
rather than raising them, to keep that change to a refactor. They were raised under BL-065, and the
pair that shows it is `docs/ux-artifacts/10-controls-dark-before.png` against
`docs/ux-artifacts/10-controls-dark-after.png`, with `docs/ux-artifacts/10-controls-light-before.png`
and `docs/ux-artifacts/10-controls-light-after.png` for the light theme. The "before" halves are
reproduced by putting the tokens back to their old values through the CSSOM rather than by checking
out the old tree, so the two halves of each pair differ in nothing else. Layout is identical between
them, as it was for the pair above, so what differs is the boundary alone.
`docs/ux-artifacts/10-reading-controls-dark.png` and
`docs/ux-artifacts/10-reading-controls-light.png` show the whole surface the crops come from.

BL-065 raised boundaries, which left one filled control unanswered: the cover-art switch, whose
state is the colour of its track rather than an outline around it. BL-067 raised that, and the pair
showing it is `docs/ux-artifacts/12-covers-switch-dark-before.png` against
`docs/ux-artifacts/12-covers-switch-dark-after.png`, with
`docs/ux-artifacts/12-covers-switch-light-before.png` and
`docs/ux-artifacts/12-covers-switch-light-after.png` for the light theme. These are captured
differently from the pair above and the difference matters: the "before" halves come from checking
the stylesheet out at its previous state rather than from overriding the token through the CSSOM,
because the off-state track and the knob's off-state position are set by the same rule and driving
one without the other would picture a state the app never renders. Everything else is held: the
same seeded fixture, the same view, the same 1280 by 900 viewport at 4x, and the control located by
id rather than by taking whichever switch rendered first, which on an earlier attempt cropped the
progress ring beside it in one half of the pair and not the other.

BL-067's review then found three red boundaries that no pair measured at all, and BL-069 brought
them under measurement. There is no before-and-after here, because no colour changed: the point of
those shots is to show what was going ungated. `docs/ux-artifacts/14-accent-surfaces-dark.png` and
`docs/ux-artifacts/14-accent-surfaces-light.png` show two of the three at once, the red brand mark
at the top of the rail and the 3px accent bar beside the selected item. The rail item has to be
selected before the shot is taken, because nothing carries `aria-current` on a fresh load:
`showView` writes it only to `.ri[data-view]` at `src/js/main.js:1296-1298`, and no rail item declares
`data-view="home"`. The brand does, but the brand is not an `.ri`. So a capture of the page as it
first loads photographs a bar that is not rendered and passes for a picture of nothing.
`docs/ux-artifacts/14-blocked-banner-dark.png` and `docs/ux-artifacts/14-blocked-banner-light.png`
show the third, the two red buttons in the unreadable-data banner, whose background is a colour mix
the gate previously could not compute. Those two shots also settle a wrong reading made while
measuring them: the buttons differ by one class in the markup and are identical on screen, because
the class is one the stylesheet never defines.

BL-072 then acted on that last observation rather than filing it. Reading those two shots beside the
banner's own prose, which tells the reader to download a copy first and only then start fresh,
showed that the two buttons carried equal weight while the words did not, and that the equally loud
one is the destructive action. `docs/ux-artifacts/15-blocked-hierarchy-before-dark.png` against
`docs/ux-artifacts/15-blocked-hierarchy-after-dark.png`, with
`docs/ux-artifacts/15-blocked-hierarchy-before-light.png` and
`docs/ux-artifacts/15-blocked-hierarchy-after-light.png` for the light theme, show the change: Start
fresh drops to the ghost treatment the app already uses for the way out of a confirm dialog, and
Download a copy keeps the filled one. Both halves of each pair are captured from the same seeded
fixture with the banner forced open, at the same 1280 by 900 viewport, so the only difference in the
frame is the one class.

Verifying that pair needed a method the earlier shots did not. The ghost button sits on the banner,
which is itself a colour mix, so `getComputedStyle` reports the button's own `rgba(255,255,255,0.06)`
rather than what the screen shows, which confirms the stylesheet and proves nothing about the render.
The check instead samples the painted pixel, by taking a one-pixel screenshot of the button's centre
and inflating it, which is the only reading that survives compositing. It gives `#38302b` in dark and
`#e3dcd4` in light, matching what `scripts/check-palette.mjs` computes for that surface to the byte,
so the two new gated pairs measure the colour a reader actually sees.

#### UX-A-009: The full availability description is carried only in a title attribute

Surface: availability badge, reading view rows
Criterion: WCAG 2.2 4.1.2 Name, Role, Value, Level A
Severity: 2, single-rater estimate
Rationale: affects the information most specific to this product, on every row, though a short
label is always visible alongside it
Confidence: Observed
Evidence: `src/js/main.js:2785-2790`, `src/js/main.js:2845-2850`
Source: WCAG 2.2 Level A sweep, criterion 4.1.2
Impact: the badge shows a short label and puts the full description in a `title` attribute. `title`
does not appear on touch, is inconsistently surfaced to keyboard users, and is announced
inconsistently across screen readers. Since the whole point of the availability model is to
distinguish absence of data from a scheduled date from an expectation from an explicit override,
the distinction most at risk of being lost is the one the product most wants to make.
Recommendation: move the full description into visible or programmatically associated text rather
than `title`, preserving all five states
Backlog item: BL-027
Resolved: the description is now a `visually-hidden` span inside the badge, so it is text a reader
reaches in sequence rather than an attribute beside it, and the pending badge's explanation
moved the same way. The Evidence anchor names the badge as it now stands; the Impact above
describes the `title` it replaced. `describe()` is called unchanged, so all five states stay
distinct and none of them asserts that an issue is available.

## Step 3: Shipped versus intended design

`design/mockups/` holds five named directions, `1-longbox.html` through `5-longbox-focus.html`,
alongside a `design/mockups/index.html` contact sheet and `mock-data.js`.

### Which direction was adopted

Direction 5, Longbox Focus, was adopted. Two independent pieces of evidence agree. The shipped
stylesheet names it in its own header comment, and the mockup contact sheet marks that direction as
the one to build. Evidence: `src/styles.css:1-4`, `design/mockups/index.html:51-62`.

### The generated data file carries no unshipped intent

`design/mockups/mock-data.js` opens by stating it was generated from `src/data/hickman_full.json`.
Reading its fields for unbuilt features is therefore not applicable, because a file generated from
shipped data is a projection of the shipped model and can only contain fields the shipped model
already has. Evidence: `design/mockups/mock-data.js:1`.

### Gaps between the mockups and the shipped UI

Twelve ideas appear in the mockups and not in `src/`. Eleven are deliberate descopes and stay in
this study rather than becoming backlog items, because they belong to directions 2, 3 and 4, which
were not adopted. Choosing one direction is what makes the other directions' ideas descoped rather
than outstanding, and that is the basis for the classification in every case below.

| Idea | Direction | Classification | Basis |
|------|-----------|----------------|-------|
| Command palette | 2 | Deliberate descope | Belongs to a direction not adopted |
| Stats strip | 3 | Deliberate descope | Belongs to a direction not adopted |
| Dense table view | 3 | Deliberate descope | Belongs to a direction not adopted |
| Bulk mark-above-read | 3 | Deliberate descope | Belongs to a direction not adopted |
| Arrow and Escape list navigation | 2 | Deliberate descope | Belongs to a direction not adopted |
| Spine timeline | 4 | Deliberate descope | Belongs to a direction not adopted |
| Inline You are here card | 4 | Deliberate descope | Belongs to a direction not adopted |
| Jump to position control | 4 | Deliberate descope | Belongs to a direction not adopted |
| Light serif theme | 3 | Deliberate descope | Belongs to a direction not adopted |
| Select-based list switcher | 2 | Deliberate descope | Belongs to a direction not adopted |
| After this strip | 4 | Deliberate descope | Belongs to a direction not adopted |
| Library sub-views | 5, adopted | Unshipped intention | Present in the adopted direction's own rail and absent from the shipped rail |

Only the last one is promoted.

#### UX-I-003: Two Library sub-views from the adopted direction were never built

Surface: rail, Library section
Criterion: information architecture, adopted design direction
Severity: 2, single-rater estimate
Rationale: affects findability of two whole classes of the reader's own data, but there are
workarounds through the existing list views
Confidence: Observed
Evidence: `design/mockups/5-longbox-focus.html:169-172`
Resolution evidence: the current Library hub includes both views at `src/index.html:343-376`
Source: Step 3 comparison of the adopted direction against the shipped rail
Impact: the adopted direction's rail offers Everything read and Added by hand alongside Progress by
series. Only Progress by series shipped. A reader therefore has no single place to see their whole
reading history across lists, and no way to find the issues they entered by hand, even though the
data model already distinguishes both. The manual-entry marker in particular exists and is rendered
per row, so the grouping view is the only missing piece. Evidence for the existing marker:
`src/js/main.js:2790`.
Recommendation: add the two rail entries as filtered views over existing data, reusing the manual
source marker and the global read map
Backlog item: BL-038
Resolved: BL-038 added Everything read and Added by hand as filtered views over the existing read
map and manual-entry marker. Both now sit with saved lists and Progress by series under My Library.
The finding above remains as the record of the state that prompted the work.

## Step 4: Live UI inspection

Run against `http://127.0.0.1:8899/` with the origin seeded as described in Scope and method. The
server was stopped on completion. Full output is in `docs/ux-artifacts/live-inspection.json`,
`viewport-sweep-reading.json`, `target-spacing.json` and `render-cost.json`, with 17 screenshots
alongside them.

### Keyboard

45 tab stops were captured walking forward from the skip link, and a reverse walk was run with
Shift and Tab. Focus order matched reading order. Every stop carried a visible focus affordance, a
3 pixel solid outline. No trap was found, and the reverse walk escaped cleanly to the document
body. Exactly one stop was not visible, a 1 by 1 pixel input at zero opacity, and that is the
standard visually-hidden filter radio paired with a visible label, not a stray control. Evidence:
`src/styles.css:660`, `src/js/main.js:2018-2021`.

Dialog focus return was not testable, because the application contains no dialogs at all. The
measured DOM has zero elements with `role="dialog"`, zero `dialog` elements and zero `aria-modal`
attributes, which is consistent with UX-H-002: confirmation and naming are delegated to native
browser dialogs instead. Evidence: `docs/ux-artifacts/live-inspection.json`.

#### UX-D-003: The advertised keyboard shortcut stops working after a click

Surface: reading view, after activating any button
Criterion: heuristic 7, Flexibility and efficiency of use
Severity: 3, single-rater estimate
Rationale: breaks the product's only workflow shortcut at exactly the moment a reader would repeat
it, and the failure is silent
Confidence: Observed
Evidence: `src/js/main.js:2876-2899`, `src/index.html:297`
Source: heuristic 7 sweep, code-only framing, confirmed against the live tab ring
Impact: the shortcut handler returns early when the active element is a button, link or input. The
hero advertises D for Done, next. Clicking that button leaves it focused, so the very next press of
D does nothing, with no feedback explaining why. The reader must click elsewhere or press Tab to
restore the shortcut, which is not discoverable.
Recommendation: exclude only text entry contexts rather than all interactive elements, or move
focus deliberately after the action completes
Backlog item: BL-026
Resolved: BL-026 took both halves of the recommendation. The guard now asks two narrower questions
instead of one broad one: whether the control consumes typed characters, which stops every
shortcut, and whether the browser would itself act on the key, which stops Enter alone. Evidence:
`src/js/lib/shortcuts.js:26-60`. D therefore survives a click on the hero button. Focus is also
moved deliberately in the one case where the old behaviour lost it, when the last issue is marked
read and the hero is hidden out of the document.

### Viewports

Swept at 320, 390, 768, 1280 and 1920 pixels against the seeded reading view, whose active list
holds 20 issues, with all rows rendered. `scrollWidth` was compared against `clientWidth` at each
width. The first sweep in this run
measured the progress view by mistake and reported no overflow anywhere, which would have been a
false all-clear. It was re-run against the reading view, and that is the data reported here.

| Width | scrollWidth | Horizontal overflow | Widest overflowing element | Rail position | Main content starts at |
|-------|-------------|---------------------|----------------------------|---------------|------------------------|
| 320 | 413 | Yes, 93 px | `li.tile` | sticky | y = 900 |
| 390 | 413 | Yes, 23 px | `li.tile` | sticky | y = 900 |
| 768 | 768 | No | none | sticky | y = 900 |
| 1280 | 1280 | No | none | sticky | y = 0 |
| 1920 | 1920 | No | none | sticky | y = 0 |

#### UX-D-001: The mobile layout rule never takes effect, because a later rule overrides it

Surface: every viewport at or below 880 pixels
Criterion: information architecture and heuristic 8
Severity: 4, single-rater estimate
Rationale: catastrophic in its category. It defeats the entire mobile layout on every load, on the
device class the product is explicitly meant to be used beside, and it will never be noticed by
reading the media query alone because the media query is correct
Confidence: Measured
Evidence: `src/styles.css:260-263`, `src/styles.css:267-271`,
`docs/ux-artifacts/viewport-sweep-reading.json`
Source: mobile viewport framing, viewport sweep
Impact: the stylesheet contains a media query that collapses the rail to `position: static` and
`height: auto` below 880 pixels. It is dead code. The base `.rail` rule that sets
`position: sticky` and `height: 100vh` is declared afterwards at equal specificity, and media
queries add no specificity, so the later rule wins at every width. Measured at 320, 390 and 768
pixels, the rail computes to `position: sticky` with a height of 900 pixels and main content begins
at y = 900. Every mobile visitor must scroll past a full screen of navigation, on every load,
before reaching the reading list. The intended mobile layout has never shipped.
Recommendation: move the media query below the base rule, or raise its specificity, and add a
check that pins the computed rail position at a narrow width so the regression cannot return
silently
Backlog item: BL-028

#### UX-D-002: The reading view scrolls horizontally at 320 and 390 pixels

Surface: reading view, narrow viewports
Criterion: WCAG 2.2 1.4.10 Reflow, Level AA
Severity: 3, single-rater estimate
Rationale: affects the whole reading surface on small phones, persistently, and two-axis scrolling
is a recognised barrier rather than an inconvenience
Confidence: Measured
Evidence: `docs/ux-artifacts/viewport-sweep-reading.json`,
`docs/ux-artifacts/08-reading-seeded-320.png`
Source: WCAG 2.2 Level AA sweep, criterion 1.4.10
Impact: at 320 pixels the document scrolls to 413 pixels, which is 93 pixels of horizontal
overflow, and at 390 pixels it overflows by 23 pixels. Reflow requires content to be usable at 320
pixels without scrolling in two directions. The widest overflowing element is the shelf tile in
both cases. From 768 pixels upward there is no overflow.
Recommendation: let the shelf scroll within its own container or wrap its tiles, so the page itself
never exceeds the viewport width
Backlog item: BL-028

### User preference emulation

`prefers-color-scheme` was emulated in both light and dark and `prefers-reduced-motion` was set to
reduce, with a screenshot captured for each. The light and dark screenshots are byte-identical,
which is the measurement behind UX-A-008. Reduced motion is genuinely honoured: the progress ring
transition computes to `none` under the reduce preference. Evidence:
`docs/ux-artifacts/live-inspection.json`, `src/styles.css:493`, `src/styles.css:1462-1469`.

## Step 5: Information architecture and generative artifacts

### Information architecture review

Labelling is a strength. The rail groups by the reader's intent rather than by data type, using
Reading, Discover and App, and the labels read as plain English tasks. Evidence: `src/index.html:42-87`.
Library now holds saved lists, Everything read, Progress by series and Added by hand. Evidence:
`src/index.html:343-376`.

Navigation depth is shallow. The rail opens the Library, Browse and Add hubs, and each hub exposes
its related destinations without making the rail itself scroll through them. The five Add workflows
remain separate addressable screens, while the Add address now opens their hub. Evidence:
`src/index.html:42-87`, `src/js/lib/route.js:20-31`.

The two missing Library sub-views recorded as UX-I-003 are now present, closing the grouping gap.

Addressability is the significant architectural finding, and it is recorded below.

#### UX-I-001: No application state is addressable

Surface: whole application
Criterion: information architecture, addressability of state
Severity: 3, single-rater estimate
Rationale: affects every view for the life of the product. It cannot be worked around, and it
quietly removes browser behaviours the reader already expects
Confidence: Verified absent, confirmed by measurement
Evidence: `absent: pushState|replaceState|location.hash|hashchange|popstate|history\., grep across
src/ returning no matches`, `src/js/main.js:1282-1323`,
`docs/ux-artifacts/live-inspection.json`
Source: Step 5 information architecture review, addressability
Impact: view switching mutates a module-level variable and toggles the `hidden` attribute. No
routing of any kind exists. Measured after navigating to the progress view, the URL is still the
bare origin with an empty hash and an empty query, and history length did not grow. The
consequences are concrete: the browser Back button does not return to the previous view, a view
cannot be bookmarked, a reload always lands on the default view, and the reader cannot open two
views in two tabs. For an app used beside Marvel Unlimited, losing Back is the costly one.
Recommendation: reflect the active view and list in the URL hash and restore from it on load,
which is the smallest change that returns Back, reload and bookmarking together
Backlog item: BL-036
Resolved: BL-036 took the recommendation as written. The evidence above is left describing the
state that prompted the finding, including the grep that found no routing at all, because a
finding's evidence records what was measured when it was raised. Four of those six terms are now
present: `replaceState`, `location.hash`, `hashchange` and `history.`. Two are still absent, and
deliberately so. `pushState` is absent because a history entry is created by assigning to
`location.hash`, which is what a deliberate navigation does, and `popstate` is absent because the
listener is on `hashchange`, which is the event a fragment change actually raises. The view and the
active list are carried in the hash, restored on load, and Back and Forward move between views
rather than out of the app. The hash was the only mechanism available rather than the merely
preferable one: Repository Constraint 5 binds the storage bucket to one origin, and `server.mjs`
serves files with no single-page fallback, so a path such as `/read/list-abc` would have 404d on
exactly the reload and bookmark this finding asks for. The measurement above was re-run against the
shipped code and reversed on every count, which is recorded in BL-036's block.

#### UX-I-002: The filter selection resets on every reload

Surface: reading view filters
Criterion: information architecture, state persistence
Severity: 2, single-rater estimate
Rationale: affects a control the reader is likely to set once and expect to keep, on every reload,
though resetting to All is a safe default rather than a harmful one
Confidence: Observed
Evidence: `src/js/main.js:144`, `src/js/lib/readingFilters.js:25-50`
Source: Step 5 information architecture review, addressability
Impact: the filter lives in a module-level variable initialised to `all` and is never persisted. A
reader working through a long list with the Unread filter set loses it on every reload and silently
returns to seeing every issue. This differs from UX-I-001, which is about view identity in the URL
rather than about control state surviving a reload.
Recommendation: persist the filter with the rest of the reader's settings, or carry it in the URL
alongside the view from UX-I-001
Backlog item: BL-037
Resolved: BL-037 shipped the first of the two options. The filter is saved with `apiBase` and
`covers` and restored before the first render, so the opening paint is already filtered. It stays
one filter shared by every list, which is how it already behaved while the app was open. The URL
half is now unblocked rather than done: BL-036 has landed and named the scheme, and carrying the
filter in it is BL-037's remaining task.

### Proto-persona

Assumption-based and unvalidated. This is a single-user private application, so there is exactly
one persona and Repository Constraint 10 rules out segment thinking. Every attribute carries an
evidence value and the cheapest question that would confirm or kill it.

| Attribute | Assumed value | Evidence value | Cheapest confirming question |
|-----------|---------------|----------------|------------------------------|
| Relationship to Marvel Unlimited | Active subscriber who reads in the web reader | Strong. The entire product deep-links into the reader and the link contract was validated against a live subscription. `src/js/reader.js:12` | Is the subscription current, and is the web reader the usual way in rather than the mobile app? |
| Primary device while reading | Desktop or laptop, with the tracker beside the reader | Moderate. The reflow and rail defects would be intolerable if a phone were the main device, and they shipped. `docs/ux-artifacts/viewport-sweep-reading.json` | On the last five reading sessions, what was the tracker open on? |
| Reading style | Follows a long curated order end to end rather than dipping in | Strong. The product is built around order, resume and next-unread rather than around browsing. `src/index.html:270-305` | When a list is abandoned partway, what caused it? |
| Tolerance for missing metadata | High, provided the app admits what it does not know | Strong. Pending and by-hand states are surfaced rather than hidden, and this was a deliberate decision. `src/js/main.js:2789-2790` | Would you rather see a guess or a clearly marked gap? |
| Attitude to cloud services | Actively prefers local-only and treats that as the point | Strong. Recorded as a product constraint and stated in the backlog's own out-of-scope list. `PRODUCT_BACKLOG.md:454-456` | If sync existed and was opt-in, would you turn it on? |
| Accessibility needs | None known, and unasked | Weak. This is an assumption by absence. No accessibility requirement appears anywhere in the repository, and the shipped contrast and target sizes are consistent with nobody having needed otherwise. | Do you use any system accessibility setting, including text size, contrast or reduced motion? |

Any other user type is speculative: a second reader would most plausibly be someone handed a
backup file who wants to follow the same order, which the export and restore paths already
support without any account.

### Job stories

Written in the form when situation, I want motivation, so I can expected outcome. These are
sentence frames rather than quotations. Nobody said these words.

* When I finish an issue in the Marvel Unlimited reader, I want to mark it read and be shown the
  next one without hunting, so I can keep reading rather than keep bookkeeping. Traced to
  `src/index.html:270-305` and `src/index.html:297`.
* When I open a crossover I have never read, I want to know how much reading I am committing to
  before I import it, so I can pick the essential path or the complete path deliberately. Traced to
  `src/js/main.js:1900-1933`.
* When an issue has no metadata yet, I want the app to say so plainly, so I can tell a pending
  lookup apart from a comic that does not exist. Traced to `src/js/main.js:2789-2790`.
* When I have read half of a long order across several sittings, I want to come back and see where
  I stopped, so I can resume without scrolling to find the boundary. Traced to
  `src/js/main.js:4513-4571`.
* When my browser storage is cleared or I move machines, I want my progress back from a file I
  control, so I can keep my history without an account. Traced to `src/js/lib/model.js:1046-1077`.
* When I follow one crossover, I want its progress counted for that list alone, so I can see how
  far through this story I am rather than a total across everything I have ever imported.
  Hypothesis, and the gap behind existing story 4.2. Traced to `src/index.html:380-382`.
  Resolved: BL-014 scoped the count to the active list and put the choice in the view at
  `src/index.html:381-385`, with the subtitle naming whichever of the two is being counted.
* When I read on my phone beside the reader, I want the list to be the first thing on screen, so I
  can mark an issue read without scrolling past the whole menu. Hypothesis, and the gap behind
  UX-D-001.

### As-is journey map

Low fidelity and stamped as a hypothesis. It is assembled from code and measured behaviour, not
from observing anyone. Every low point cites a finding.

| Stage | What the reader does | Hypothesised state | Low points |
|-------|----------------------|--------------------|------------|
| First run | Opens the app to an empty library, reads the landing copy, goes to the catalog | Curious, low commitment | UX-A-007 |
| Choosing an order | Compares lists, reads depth labels and attribution, imports one | Confident. This stage is well served | none identified |
| First read | Opens the hero call to action, lands in the Marvel Unlimited reader | Satisfied, the core promise lands | UX-A-001, UX-A-003 |
| Settling into a rhythm | Marks read, returns, marks read again, uses D | Fluent until the shortcut stops responding | UX-D-003, UX-H-001 |
| Filtering to what is left | Sets the Unread filter, works through the remainder | Efficient, until a reload resets it | UX-I-002 |
| Reading on a phone | Opens the app beside the reader on a small screen | Frustrated. The list is a full screen away and the page scrolls sideways | UX-D-001, UX-D-002, UX-A-005 |
| Checking progress | Opens Progress by series to see how far through the crossover they are | Confused. Counts include every other list they ever imported | Existing story 4.2, `src/index.html:380-382` |
| Going back | Presses the browser Back button after moving between views | Surprised. Back leaves the application entirely | UX-I-001 |
| Tidying up | Deletes a list made by mistake | Uneasy. A native dialog, then no way back | UX-H-002, UX-H-003 |

### Usability test plan

Tasks, measures and method only. This plan has not been run and this study states no results from
it.

| # | Task | What to measure | How to measure it |
|---|------|-----------------|-------------------|
| 1 | On a fresh install, find and start a reading order for a named event | Time to first import, wrong turns in the rail, whether depth labels are read before choosing | Think-aloud, screen recording, count of rail entries opened before the catalog |
| 2 | Read one issue and return to mark it read, three times in a row | Whether D is discovered, whether it is used a second time, hesitation after the first click | Screen recording with key logging, noting the first press of D that does nothing |
| 3 | On a phone, mark the next unread issue read | Time to first interaction with the list, scroll distance before the list is visible, any sideways scrolling | Device recording at 390 pixels, scroll offset at first row interaction |
| 4 | Find out how far through one crossover you are | Whether the reader believes the number, and whether they notice it spans all lists | Ask the reader to state the number and explain what it counts |
| 5 | Return to the previous view after browsing the catalog | Whether Back is attempted, and what happens when it is | Screen recording, note every Back press and the resulting state |
| 6 | Recover reading progress into a second browser | Completion without help, and points of hesitation in export and restore | Time on task, count of assists |
| 7 | Delete a list created by mistake, then try to get it back | Whether recovery is attempted, and the reaction on finding none | Think-aloud, note any search for undo |

Measures to hold across all tasks: task completion, assists required, and self-reported confidence
before and after. Sample size is one, so results will be diagnostic rather than statistical, and
should be recorded as such.

## Findings index

| ID | Title | Severity | Confidence | Backlog item |
|----|-------|----------|------------|--------------|
| UX-H-001 | A single read toggle re-renders the entire application | 2 | Measured | BL-033 |
| UX-H-002 | Native browser dialogs run alongside the in-page notice system | 3 | Observed | BL-034 |
| UX-H-003 | Deleting a list cannot be undone, while restoring a backup can | 3 | Observed | BL-035 |
| UX-H-004 | The advertised keyboard shortcut is documented only where it is used | 2 | Observed | BL-026 |
| UX-A-001 | The primary call to action and the accent text fall below 4.5:1 | 3 | Measured | BL-029 |
| UX-A-002 | Read rows are dimmed by a blanket opacity that pushes text to 2.34:1 | 3 | Measured | BL-030 |
| UX-A-003 | Hero text contrast is undeterminable because it sits on a blurred cover | 3 | Measured | BL-031 |
| UX-A-004 | Row controls are below 24 by 24 pixels but pass through the spacing exception | 2 | Measured | BL-028 |
| UX-A-005 | Row actions are invisible until hover, so a touch user cannot see them | 3 | Measured | BL-028 |
| UX-A-006 | Status messages are announced twice | 2 | Observed | BL-027 |
| UX-A-007 | The first-run DOM ships an empty heading | 2 | Measured | BL-027 |
| UX-A-008 | The interface is locked to a dark scheme | 2 | Measured | BL-032 |
| UX-A-009 | The full availability description is carried only in a title attribute | 2 | Observed | BL-027 |
| UX-D-001 | The mobile layout rule never takes effect, because a later rule overrides it | 4 | Measured | BL-028 |
| UX-D-002 | The reading view scrolls horizontally at 320 and 390 pixels | 3 | Measured | BL-028 |
| UX-D-003 | The advertised keyboard shortcut stops working after a click | 3 | Observed | BL-026 |
| UX-I-001 | No application state is addressable | 3 | Verified absent | BL-036 |
| UX-I-002 | The filter selection resets on every reload | 2 | Observed | BL-037 |
| UX-I-003 | Two Library sub-views from the adopted direction were never built | 2 | Observed | BL-038 |

## Coverage and Limitations

Every depth level that was skipped, and why.

**The expected browser tooling was not available.** The chat browser tools this method assumes were
absent in this environment, which is rung 2 of the degradation ladder. The run did not descend to a
code-only audit. It escalated instead, using `pa11y` for its bundled browser and installing
Puppeteer into a scratch directory outside the repository so that page snapshots, axe injection,
tab-ring walking, viewport sweeps and preference emulation could all still run. The practical
differences from the assumed tooling are that screenshots are viewport captures rather than
full-page captures, and that accessibility-tree snapshots were replaced by direct DOM and computed
style queries.

**Puppeteer was installed outside the repository, deliberately.** `node_modules/` is not covered by
`.gitignore`, so installing into the working tree would have dirtied it. Nothing was added to
`package.json` and no runtime dependency was introduced.

Neither did BL-093, which committed a repeatable subset of this work as `scripts/browser-check.mjs`
while keeping that decision intact: the driver is resolved from outside the tree at run time and
its absence exits 2 with install instructions rather than failing an assertion. What is repeatable
is the six product journeys, not this study. The scans, sweeps and emulation described above
remain a record of one run on one machine, and re-deriving them means installing the tooling again.

**Six WCAG criteria could not be assessed** and are named in the sweep result above: 1.4.4 Resize
Text, 1.4.12 Text Spacing, 2.4.11 Focus Not Obscured (Minimum), 1.4.13 Content on Hover or Focus,
4.1.2 Name, Role, Value for the availability badge, and 4.1.3 Status Messages. The first three need
real browser zoom, user stylesheets, or a scrolled focus walk. The last three need a screen reader
and a pointer-hover dismissal test, which no automated run substitutes for.

**No screen reader was run.** Every announcement finding, including UX-A-006 and UX-A-009, rests on
reading the code and on tool output rather than on hearing what is spoken. NVDA, JAWS and VoiceOver
each behave differently with `title` and with duplicate live regions, so these findings state a
mechanism and not an outcome.

**No real user was observed.** There is one user of this application and they were not interviewed
or watched. The proto-persona is explicitly assumption-based, the journey map is stamped as a
hypothesis, and the usability test plan has not been run. No finding in this study rests on
reported user behaviour, and no quotation appears anywhere in it, because nobody said anything to
quote.

**The pa11y landing scan covers only the first-run empty state.** Until a list is imported, the
hero, filters, rows and progress view do not exist in the DOM, so that scan reaches a small
fraction of the interface. The seeded scan and the four axe runs cover the rest, and the difference
between 4 errors unseeded and 27 seeded is a measure of how much the empty state hides.

**Performance was measured on one machine, headless, on desktop hardware.** The figures in
UX-H-001 are a floor rather than a typical experience. No phone, no throttled CPU and no cold cache
were tested.

**Severity ratings come from one evaluator.** Nielsen recommends three to five. The three-framing
mitigation described in Scope and method reduces but does not remove the unreliability, and the
ratings should be confirmed by a second reader before being used to settle a priority argument.

**Character Spotlight scope is explicit.** The current shelf has fourteen readings across thirteen
stories. Five stories appear under Best of, five under Complete guides, and four readings remain
under All only. Star-Lord appears under All and Complete but not Best of. The committed Edge gate passed 182
assertions, and 14 real-catalog assertions at 1280 by 900 and 390 by 844 confirmed those counts and
no horizontal overflow. Sharing 25 source-required issues with each of Rocket and Groot does not
combine the cards or shorten any sequence.

**MCU Prep scope is explicit.** The Hub adds one non-empty category after Timeline,
Storylines, and Character Spotlights. Its first four cards are screen companions rather than
character spotlights, and all four carry no timeline year because their picks span decades. The
category uses the shared Home and Browse gateway and disappears when no matching guide is present.
Its generated child page preserves the four-card order without adding a fourth canonical shelf.
Installed Edge passed 184 assertions across 19 scenarios, confirming the gateway count, child-route
focus, source order, one-column narrow layout, and no horizontal overflow.

**The first viewport sweep of this run measured the wrong view** and reported no overflow at any
width. It was caught by comparing screenshot hashes, re-run against the reading view, and only the
corrected data is reported. It is recorded here because the same mistake would silently produce a
false all-clear for anyone repeating this method. The screenshots from that first sweep were kept,
because they are valid captures of the progress view, and renamed from `05-reading-seeded-*` to
`05-progress-seeded-*` so that no file in the artifact directory carries a name that misstates what
it shows. The reading-view sweep is the `08-reading-seeded-*` set.
