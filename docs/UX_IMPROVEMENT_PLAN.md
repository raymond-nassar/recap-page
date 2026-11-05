# UX improvement plans

This is a planning document linked to the separate [colleague feedback record](UX_FEEDBACK.md) and tracking [#1121](https://github.com/raymond-nassar/recap-page/issues/1121). It does not authorize or implement product changes. Navigation is the highest priority. The remaining workstreams are not ranked or committed to ship.

## 1. Navigation and Back

**Outcome:** Back returns to the immediately previous screen and restores its position. Plan a clearly integrated iOS Back affordance instead of assuming the reported detached text treatment is the right design.

**Dependencies:** Identify the colleague's tested build and reproduce the affected journey. Map the route and scroll state that must be restored before choosing a UI or architecture change. The shared app already creates a history entry for rail navigation (`src/js/main.js:1280-1281`), but that alone does not establish the reported iOS behavior.

**Evidence before implementation:** Record the journey, starting and ending screens, scroll positions, and Back control in the same iOS build. Verify the proposed behavior with forward navigation, Back, repeated navigation, and a route reached from an in-screen task.

## 2. Home discovery and Search

**Outcome:** Mark Modern Timeline "Recommended start here," remove redundant first-run introduction, and remove Home's global Search shortcut. Keep global Search in the bottom bar and retain task-specific search fields. The current Home first-run block contains introductory copy (`src/js/views/home.js:88`), a Modern Timeline action (`src/js/views/home.js:101`), and a Search action (`src/js/views/home.js:111`). Search is also in the bottom bar (`src/index.html:57`).

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

**Outcome:** After iOS ends and reloads the page, show the saved-progress reassurance and slide it away after about five seconds. Do not show it on an ordinary launch. The current lifecycle sets a one-load restart flag (`packaging/ios/RecapPage/WebViewController.swift:384`) and reloads the app page (`packaging/ios/RecapPage/WebViewController.swift:398`).

**Dependencies:** Confirm the message's exact text, animation, and accessibility announcement. Respect reduced-motion settings and avoid hiding it before assistive technology can announce it.

**Evidence before implementation:** Test ordinary launch, process termination and reload, a second termination, and a delayed reload. Verify the message appears only after termination, remains readable, and dismisses at the agreed interval.

## 6. App title and launch splash

**Outcome:** No UI change is planned until the report is identified. Determine whether the title is in the app chrome, web page, system status area, or launch screen, and whether the proposed splash refers to the same surface.

**Dependencies:** Obtain a screenshot or reproducible steps and the exact tested iOS build.

**Evidence before implementation:** Record device, OS, build, launch state, and the visible title/splash sequence. Revisit scope only after the owner confirms the surface.

## 7. MCU Prep labels

**Outcome:** Keep the labels as labels unless evidence and an owner decision establish that they should filter. The received "Multiverse Packs" wording differs from the current "Multiverse picks" label (`src/js/lib/catalog.js:1339`), and the current page renders its highlights as a list rather than controls (`src/js/main.js:2724-2725`).

**Dependencies:** Verify the exact text and screen in the tested build; ask whether the colleague expected labels to be selectable or only descriptive.

**Evidence before implementation:** Observe the current flow and test the label wording with the owner before changing navigation, filtering, or category selection behavior.

## 8. Reading-list completion and next reads

**Outcome:** After a reader completes a Modern Timeline list, present one clearly identified "Next on the Modern Timeline" list first in both observed presentations, including iPad. Place genre- and tone-based suggestions below it, and show a preview comic book cover on every suggested list. Do not leave iPad readers with only the generic all-read message and "Browse Reading Lists" action shown in the supplied screenshot.

**Dependencies:** Reconcile the different completion presentations for the same list, and confirm how the next Modern Timeline list is selected. Verify that each suggested list has an approved cover URL. Do not copy or store comic image bytes or invent or substitute artwork when a cover source is missing.

**Evidence before implementation:** Reproduce both supplied completion screens and determine why the same list presents different content, including the iPad presentation. Test the redesigned hierarchy in both observed presentations and across supported layout sizes. Confirm the next Modern Timeline list is the clear first action, suggestions remain visibly secondary and are based on genre or tone, and every suggestion displays its corresponding cover. Check completion actions and browsing remain understandable alongside the new sections.

## Delivery boundary

This PR contains the feedback record and these plans only. It does not change application code, styling, saved data, release metadata, or behavior. Before implementing any accepted workstream, create or reuse a scoped Issue and rank it in the planning Project. Keep each product implementation within its own approved scope.
