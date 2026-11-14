# UX improvement plans

This plan is linked to the separate [colleague feedback record](UX_FEEDBACK.md) and tracking [#1121](https://github.com/raymond-nassar/recap-page/issues/1121). The owner subsequently authorized completion, Back navigation, Home/Search and reader-facing terminology together in [#1126](https://github.com/raymond-nassar/recap-page/issues/1126), starting with completion. The other workstreams remain exploratory and are not committed to ship.

## 1. Navigation and Back

**Outcome:** Back returns to the immediately previous screen and restores its position. Plan a clearly integrated iOS Back affordance instead of assuming the reported detached text treatment is the right design.

**Implementation boundary:** Preserve each browser-history entry's position and opener context, and provide Back within the shared breadcrumb navigation. An explicit return opener takes precedence over the old viewport so its focused control stays visible. This is a bounded shared-interface improvement, not evidence that the colleague's native-iOS concern has been reproduced or resolved.

**Acceptance evidence:** Verify forward navigation, Back, repeated navigation, asynchronous layout and a route reached from an in-screen task. Native iOS acceptance still requires the journey, starting and ending screens, scroll positions, and Back control in an identified iOS build.

## 2. Home discovery and Search

**Outcome:** Mark the existing Modern Timeline category "Recommended start here" for first-run and returning readers, remove redundant first-run introduction, and remove Home's global Search shortcut. Keep global Search in the bottom bar (`src/index.html:57`) and retain task-specific search fields. The implementation uses the existing category instead of adding another introduction or competing action group.

**Dependencies:** Check the Home wording against the exact first-run and returning-reader states. Keep the existing Search destination and in-screen search journeys intact.

**Evidence before implementation:** Test first-run Home and populated Home on narrow and wide layouts. Confirm the bottom-bar destination remains available and task-specific fields are unchanged.

## 3. Reader-facing terminology

**Outcome:** Change reader-facing uses of "issues" to "comics" where requested. Do not rename internal identifiers, API fields, saved-data keys, or schema.

**Dependencies:** Inventory visible copy and classify each occurrence before editing; do not use a global replacement.

**Evidence before implementation:** Review every changed string in its reader-facing context and verify imports, exports, backups, and existing data contracts remain unchanged.

## 4. iOS-native interaction and architecture comparison

**Outcome:** Treat native iOS feel as a design goal, not as a decision for a full rewrite. Compare the current shared web experience in a UIKit shell, a hybrid approach with bounded native screens, and a full Swift interface before selecting a direction. The iOS app is currently described as the existing web app inside a small native shell (`docs/IOS.md:7`).

**Dependencies:** Use one representative journey, beginning with Back navigation, and agree on comparison criteria before recommending an architecture. Include navigation, transitions and motion, touch interaction, accessibility, saved-progress behavior, offline use, parity with other platforms, and long-term maintenance.

**Evidence before implementation:** Provide a side-by-side prototype or equivalent interaction study for the same journey on the colleague's tested build and a known native iOS reference. Record what specifically feels non-native and which option addresses it. Apple Human Interface Guidelines pages for [Navigation and search](https://developer.apple.com/design/human-interface-guidelines/navigation-and-search) and [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) were reviewed on 2026-11-05 as comparison references, not as proof of the colleague's experience.

## 5. iOS restart reassurance

**Outcome:** After iOS ends and reloads the page, show the saved-progress reassurance and slide it away after about five seconds. Do not show it on an ordinary launch. The current lifecycle sets a one-load restart flag (`packaging/ios/RecapPage/WebViewController.swift:421`) and reloads the app page (`packaging/ios/RecapPage/WebViewController.swift:432`).

**Dependencies:** Confirm the message's exact text, animation, and accessibility announcement. Respect reduced-motion settings and avoid hiding it before assistive technology can announce it.

**Evidence before implementation:** Test ordinary launch, process termination and reload, a second termination, and a delayed reload. Verify the message appears only after termination, remains readable, and dismisses at the agreed interval.

## 6. App title and launch splash

**Outcome:** No UI change is planned until the report is identified. Determine whether the title is in the app chrome, web page, system status area, or launch screen, and whether the proposed splash refers to the same surface.

**Dependencies:** Obtain a screenshot or reproducible steps and the exact tested iOS build.

**Evidence before implementation:** Record device, OS, build, launch state, and the visible title/splash sequence. Revisit scope only after the owner confirms the surface.

## 7. MCU Prep labels

**Outcome:** Resolved by owner decision in [#1297](https://github.com/raymond-nassar/recap-page/issues/1297). The labels did not filter and the owner did not want them to; they looked selectable and were removed from every generated browse page. Each page now carries one short description line instead, MCU Prep's from its category definition (`src/js/lib/catalog.js:1352`), rendered beneath the heading (`src/js/main.js:2945`).

**Dependencies:** None remaining.

**Evidence before implementation:** The owner's screenshot of the MCU Prep header and the request to replace the labels with a short line describing the page, recorded in #1297.

## 8. Reading-list completion and next reads

**Outcome:** After a reader completes a Modern Timeline list, present one clearly identified "Next on the Modern Timeline" list first in both observed presentations, including iPad. Place genre- and tone-based suggestions below it, and show a preview comic book cover on every suggested list. Do not leave iPad readers with only the generic all-read message and "Browse Reading Lists" action shown in the supplied screenshot.

**Dependencies:** Reconcile the different completion presentations for the same list, and confirm how the next Modern Timeline list is selected. Verify that each suggested list has an approved cover URL. Do not copy or store comic image bytes or invent or substitute artwork when a cover source is missing.

**Acceptance evidence:** Test all-read and explicitly completed states across supported layout sizes, with one primary continuation and secondary genre/tone suggestions. An all-read list must not be silently recorded as explicitly completed. Honor the existing cover setting and retain a truthful fallback when a cover is missing or fails; never substitute unrelated artwork. Check retry, completion, reopening and browsing remain usable. The supplied screenshots establish different presentations, but their exact build and cause remain unknown; Edge checks of both source states do not reproduce the reported iPad environment.

**Owner visual review:** The owner approved the illustrative tablet mockup as aligned with the intended design. It establishes the hierarchy of one prominent Timeline continuation and quieter related suggestions, not the exact example ranking or placeholder artwork. Outside the Timeline, retain supported reading-path, writer and later-series suggestions under "What to read next"; show genre/tone suggestions only when a catalog identity supplies those attributes. Do not infer genres from custom list names.

## Delivery boundary

The original documentation delivery contained only the feedback record and plans. The combined implementation is scoped and ranked in [#1126](https://github.com/raymond-nassar/recap-page/issues/1126); its pull request owns delivery evidence, proposed release notes and saved-data compatibility. No saved-data schema, provider identity, cover-storage policy or native architecture change is authorized by this scope. Native feel, restart reassurance and title/splash remain separate evidence-dependent work; MCU Prep labels were resolved separately by [#1297](https://github.com/raymond-nassar/recap-page/issues/1297).
