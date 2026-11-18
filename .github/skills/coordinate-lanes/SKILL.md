---
name: coordinate-lanes
description: Coordinate parallel lane sessions for this repository, verify each lane at its exact head, merge lane pull requests, and hand off to a new session. Use when starting, resuming or handing off as the coordinator.
---

# Coordinate lanes

## Goal

Run several lane sessions against this repository in parallel without losing state, without
restating rules this repository already keeps elsewhere, and without spending tokens the
coordinator does not need to spend. A coordination session succeeds when every lane's change is
verified at its own exact commit before it merges, the state file, log, and any report stay
current and compact, and the owner hears plainly when a new coordinator session would serve
better than this one.

## Start or resume

The records, not this conversation, are the durable handoff between coordinator sessions: decisions,
owner rules and history live there. A fresh coordinator, including one resuming after a clear,
starts with bounded reads, never a full replay:

- The state file's standing-rule categories, its merge procedure, and its current sections only.
- The append-only log from its latest handoff entry onward (its last few entries if there is
  none), not a fixed number of lines: entries vary so much in length that one 120-line tail
  measured about 42 KB. Search the log for an older decision rather than reading back to it.
- The latest report, if one exists.

Records age the moment a lane pushes, merges, or finishes, so re-verify live state before acting on
anything a record says: the current tip of main, open pull requests, each lane session's status,
who holds the heavy slot, and who holds the single Grand Comics Database fetcher. Live state wins
over a record that disagrees with it.

## Run lanes

Give each independent change with a disjoint write boundary its own lane session, and create lane
sessions one at a time; two created in the same moment have drawn the same worktree name.

Every kickoff stands alone and quotes the owner's own words verbatim. State in it: the owner's
current model preference for lane sessions; that the lane runs in autopilot; that it researches
first, including a contrarian pass; that every fix ships with a test proven to fail without it;
that it never reruns an intermittent result and instead notes the intermittency on that result's
Issue; that it commits locally and pushes only to prove a `workflow_dispatch` run, never
force-pushing; that it opens no pull request until the coordinator clears it; that it asks the
coordinator for the heavy slot before a full suite; that only one lane at a time may hold the
single Grand Comics Database fetcher; and that a design decision or new reader-facing text stops at
a written proposal for the owner rather than an implementation.

Two mechanics of this host are easy to miss. A session kickoff cannot carry the owner's own message
source, and an answer given through the host's input-relay tool carries no provenance either, so
relay both as coordinator guidance that quotes the owner verbatim, not as a forwarded user message.
Check a lane's own state before resending a message that looks interrupted partway through. A lane
made by an earlier coordinator session is not this session's child: archiving it or approving its
plan can be refused, though messaging it still works. An autopilot lane stops after five automatic
continuations on its own and needs a message to resume.

Grant the heavy slot first come, first served, and record every grant and release. It may be lent
for one proof run while that lane's pushes stay held back. Running one heavy suite at a time is
already this repository's own rule, under
[Keep feature implementation bounded](../../copilot-instructions.md#keep-feature-implementation-bounded);
the heavy slot is only the coordinator's scheduling on top of it, and one full suite at an
integrated head never replaces a lane's own targeted gates.

Pre-review a lane's commits while it keeps working, rather than waiting for it to finish; a stale
count has been caught that way before a full suite ran. If a lane has already merged main into its
branch, ask it for a fix on top rather than a history rewrite. Archive a lane only once its
worktree is clean and its head is in main, or in a branch that is itself already in main.

## Verify before you trust a lane

Do not accept a lane's own numbers as the record. From a clean worktree at main, using the
repository's own functions, recompute:

- A merge commit's tree: it must equal `git merge-tree --write-tree` of its two parents.
- Every digest and report a lane produced, rather than copying its figures into the record.
- Every changed-content citation against the claim beside it, deriving each re-aim the way
  [the evidence anchors gate](../../copilot-instructions.md#the-evidence-anchors-gate-and-how-to-not-corrupt-it)
  already describes.
- Any count a document states, rather than carrying an old number forward.
- A licence boundary, by scanning for the value itself as well as for its marker, so an
  unregistered case is not missed.

Beyond recomputation: compare reader-facing text the owner approved against the exact wording
given, word for word, and save what was shown to the owner in a file at the time of approval; that
wording has only been recoverable from a session event log on the occasions this step was skipped.
Confirm a forced or injected bug reproduction also happens on a natural code path before treating
it as real. Diff a Dependabot regeneration for dropped code and changed line endings, not only for
the version bump. Reproduce a suspected pre-existing failure in a throwaway worktree at main and
again at the commit before the suspect merge, then file it on a bug-template Issue and keep it out
of the unrelated pull request. Record model authority as model authority, and disclose any change
the coordinator itself made in both the pull request body and the report.

## Merge

The merge mechanics already have a canonical home: this repository's
[Commits and pull requests](../../copilot-instructions.md#commits-and-pull-requests) and
[Reading CI honestly](../../copilot-instructions.md#reading-ci-honestly) guidance, and the
`deliver-pr` and `diagnose-ci` skills.
Follow those rather than a second copy of them; a coordinator adds only what they do not cover.

- Wait for every non-iOS check and the separate CodeQL summary before treating a run as clean.
- When the [UI owners alignment record](../../../docs/MAINTAINING.md#the-ui-owners-job) lists a
  move, confirm its cause in code first, then explain every listed move in the pull request.
- Keep a pull request's own iOS run when it is the change's native proof; otherwise cancel it
  under the owner's standing direction. Judge an iOS run from the complete test logs in its
  ios-results artifacts, because the job log can end early, and scan them with a script so only a
  short summary and any failing or T03 lines enter context.
- While Issue #1032 is open, apply its rule: a failed iOS job may still be merged past only when
  every failing message is a signature #1032 already records and everything else passed, with the
  occurrence noted on #1032. Record a "T03 More first tap left no sheet" line on both #1316 and
  #1032 if it appears.
- Merge one pull request at a time, at the reviewed head, after re-checking main. Branch
  protection is strict, so merging one pull request means every other open one needs main merged
  into it again, and because worktrees share remote-tracking refs, merge the exact main commit
  that was reviewed, not a later one.
- Never hold a ready pull request behind one whose checks are still failing.
- After a merge, confirm main's tree equals the merged head's tree, cancel main's duplicate iOS
  push run with the owner's standing direction as the recorded reason, and re-read its state after
  a few minutes rather than repeating the cancel.
- Archive the finished lane, then send every other open lane the new main commit.

## Spend tokens carefully

The owner asked directly for token-efficient coordination, so treat the following as requirements:

- Wait with watchers that print only when something changes, such as a lane's local HEAD, a pull
  request appearing, or a run concluding, and prefer a lane's own notification to polling it.
- Ask a tool for only the fields a decision needs, and summarize a large result with a small
  script rather than reading it whole.
- Reach for a search or a bounded view range before an unbounded read; save a large output to a
  file and work from its count or summary instead of pulling it into context.
- Keep the state file a compact current snapshot rather than a growing history: move a finished
  lane's history into the log at wrap-up, and read the state file by section afterward. It once
  grew to roughly 38 KB, and reading all of it was the largest avoidable cost in a handoff.
- Verify a fact once and record it; do not re-derive or re-read something that has not changed.
- Keep a lane message short and limited to what is new, without an acknowledgment it does not
  need.
- Delegate long or heavy work to a lane and review its result, rather than redoing the work
  directly.
- Reuse the helper scripts already in the coordinator files folder named in the kickoff; do not
  recreate them, and never park a reusable helper in a temporary directory.

## Recommend a new session and hand off

Recommend a new coordinator session to the owner rather than waiting to be asked, when any of
these holds: the host has summarized this conversation once, in which case plan the recommendation
for the next safe boundary, or more than once, in which case recommend it promptly; coordination
has run continuously for about a day; a new batch or an overnight run is about to start in an
already long session; or the owner says the context feels large.

Act on that only at a safe boundary: no merge in flight, no background agent whose findings have
not yet been relayed, and no lane waiting on context that is not yet written into the records.

Hand off before recommending anything. Write a compact state snapshot, a handoff entry in the log, and a report
if a batch just finished; confirm the helper scripts live in the coordinator files folder rather
than a temporary one; then write a successor prompt. The successor prompt names who the new
session is and where its records live, states that the records are the durable handoff and live
checks decide current state, lists the bounded reads and the live re-verification checklist above,
quotes the owner's latest direction verbatim, states the immediate next work and anything still
waiting on the owner, and tells the new session to load this skill. Only then tell the owner this
is a good point to start a new session, give the one-line reason, and name the exact file to paste
into it.

## Keep the records

Overwrite the state file when state changes; treat the log as append-only. Run `Get-Date`
immediately before writing a time into either one, and when recording something after the fact,
give it the event's own time rather than the time of the write. Confirm the log already ends with
a newline before appending, so a new entry does not join onto the last one. Record an owner
decision in the owner's own words.

The state file is the verbatim home for the owner's standing rules; name its categories here and
point to it rather than copying the wording, because a second copy only drifts from the first.
Its categories include merge authorization, pull request scope, reader-facing text staying in
plain language, iOS push-run cancellation, the #1032 and T03 rules, never rerunning an intermittent
result, always merging a Dependabot update, delegated test-build approval with public steps
staying owner-only, the heavy slot, the single Grand Comics Database fetcher, and never holding a
ready pull request behind a failing one.

When a rule could reasonably apply to every repository the owner works in, not only this one, ask
its scope before storing it as a memory, and upvote a memory that a later session reconfirms. Post
a GitHub comment from a file and compare it against the live text afterward, following
[Commits and pull requests](../../copilot-instructions.md#commits-and-pull-requests).

## Limits and owner authority

This skill guides the workflow; this repository's own gates, permissions, and approvals stay
authoritative over it, never the other way around, and it grants the coordinator no authority the
owner has not given. These stay owner-only on every lane and every merge:

- What goes into a pull request: ask before creating one.
- Any new reader-facing text, kept in plain language, in the owner's own wording once given.
- A design decision.
- A public store step.
- A protected-workflow approval beyond a delegated test build.
- Anything already recorded as waiting on the owner.

Stop and ask when an action would need authority the owner has not given, rather than guessing at
it.
