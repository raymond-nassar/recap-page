# Colleague UX feedback

This record captures feedback about the iOS experience as relayed by the maintainer. It is separate from the single-rater audit in [UX_STUDY.md](UX_STUDY.md). That study says no real user was observed and its findings are not colleague feedback (`docs/UX_STUDY.md:953-954`).

The colleague's identity, the tested build, and the exact screen or steps for every observation are not recorded here. This document does not reproduce a complete verbatim transcript; only text explicitly preserved below is quoted. Paraphrases are labeled and must not be presented as verbatim colleague quotes. Track this work in [#1121](https://github.com/raymond-nassar/recap-page/issues/1121).

## Feedback signals

| Signal | Evidence type | What is known and what is not |
|---|---|---|
| iOS does not feel native | Maintainer's paraphrase of the colleague, not a verbatim colleague quote | The owner's exact wording was: He basically indicated that the app doesn't "feel" like it's written in Swift. All of the actions, movements, etc. aren't native to iOS. This is a broad design impression, not a decision to rewrite the app in Swift. The exact build, affected actions, and observed movement are not yet identified. |
| Back navigation | Owner-confirmed priority and desired outcome, not a verbatim quote | This is the first improvement to plan. Back should return to the immediately previous screen and restore that screen's position. The reported presentation should be checked on the tested build before prescribing a control redesign. |
| Reader-facing terminology | Owner-confirmed direction | Use "comics" instead of "issues" in reader-facing copy only. Internal identifiers and saved-data structures are out of scope. |
| Home recommendation and Search | Owner direction, including the exact Search clarification below | Modern Timeline should be identified as "Recommended start here" and redundant introductory copy removed. Global Search belongs only in the bottom bar; task-specific search fields stay within their screens. |
| Reading-list completion and next reads | Owner-provided screenshots and design direction | The owner supplied screenshots from completing the same Modern Timeline reading list. The first screenshot shows multiple cards under "What to read next" with the Modern Timeline continuation mixed among suggestions, a separate "More like this" section, and several other actions. The owner found it busy and unclear where to go next. The iPad screenshot shows a different completion screen with a generic all-read message and "Browse Reading Lists," but no next Modern Timeline list or tailored suggestions. The owner wants one clear "Next on the Modern Timeline" list first, followed by suggested lists based on genres and tones, with a preview comic book cover on every suggested list. The screenshots establish different presentations for the same list, not why they differ. This is owner feedback, not colleague feedback. |
| MCU Prep labels | Open question | The label reported as "Multiverse Packs" does not match the current code label, "Multiverse picks" (`src/js/lib/catalog.js:1358`). The current page renders highlights as a list, not as controls (`src/js/main.js:2956-2957`). Confirm the tested screen and intended behavior before deciding whether labels should filter. |
| iOS restart reassurance | Owner-confirmed desired behavior | After iOS ends and reloads the page, reassure the reader that saved progress remains, then slide the message away after about five seconds. The current native lifecycle sets a one-load restart flag (`packaging/ios/RecapPage/WebViewController.swift:421`) and reloads the app page (`packaging/ios/RecapPage/WebViewController.swift:432`); these references do not establish that the requested timing or dismissal behavior exists. |
| App title and launch splash | Unresolved report | The app title was described as staying at the top and a launch splash was proposed. The exact surface, build, and reproduction are unknown. Do not decide placement or scope until a screenshot or reproducible steps identify what was seen. |

## Owner wording preserved

The following is the owner's direction, not a quotation attributed to the colleague:

> sorry, i think search should only be accessible from the bottom bar

The bottom bar includes the Search destination (`src/index.html:57`). The accepted implementation removes Home's first-run global Search shortcut and redundant introduction; in-screen search fields remain.

The owner also supplied the following direction about the Modern Timeline completion screen:

> There should be a clear "Next on the Modern Timeline" reading list, then below that we can bring up suggested reading lists based on genres/tones. Each of the suggested reading lists should also have a preview comic book cover for visual appeal.

The owner clarified the iPad result:

> On iPad, completing the same reading list only brought up this screen

## Evidence boundary

Do not treat the older UX audit, the iOS implementation issue [#949](https://github.com/raymond-nassar/recap-page/issues/949), or the closed navigation coordination issue [#730](https://github.com/raymond-nassar/recap-page/issues/730) as a substitute for the colleague's test context. The open exploration [#895](https://github.com/raymond-nassar/recap-page/issues/895) concerns a Windows title area and search shortcut, not this iOS report. Merged PR [#942](https://github.com/raymond-nassar/recap-page/pull/942) has no UX review comments or reviews.

The owner authorized completion, Back navigation, Home/Search and terminology together in [#1126](https://github.com/raymond-nassar/recap-page/issues/1126). That bounded implementation does not resolve the unidentified native-iOS observations. Before prescribing native architecture or changing the unclear title/splash surface, identify the tested iOS build and gather a screenshot or repeatable steps. Do not broaden the feedback or infer the colleague's intent from the existing interface.
