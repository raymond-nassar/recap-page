# Publication runbook

**This runbook was executed on 2026-08-16, and the repository is now public.** It is kept as the
record of that day rather than rewritten, so read the present tense throughout it, this paragraph
excepted, as describing the state before the flip. The passages it lists have since been rewritten
and the settings it asks for are on, both under BL-133. The one thing that did not happen is the
legal review named in the first section, which remains an accepted risk rather than an answered
question.

Microsoft Store publication is a separate later event. Its maintained
[submission packet](MICROSOFT_STORE_SUBMISSION.md) keeps Store listing, certification, asset, and
owner-approval gates out of this spent repository-publication record.

Twenty-one passages in this repository are true only while it is private, spread over ten files. They
say so plainly, which was the right way to write them: a security policy that describes a reporting
route nobody can use is more use than one that pretends the route is there. The cost is that
publishing makes all of them false in the same moment, and none of them is a `path:line` claim, so
no gate will notice.

This document names every one of them rather than counting them, and it carries the search that
finds them, because that list has been incomplete twice. Treat the count as a floor and the search
as the instrument. It exists so the flip is something to work through rather than something to
remember, and so the person doing it is not also the person who has to find out what it touches.

Nothing here is a legal opinion, and nothing here says the repository should be published. The first
section is what has to be settled before it is.

## Source-backed orders added after publication

Thirty-nine historical event guides now use factual issue identities and order from Comic Book Reading
Orders. The source owner permitted credited and linked derived lists, excluding the Marvel Master
Reading Order and Patreon-only orders. Every shipped card names that source and links to the exact
source page and section. The source licence remains null because that permission does not reach Marvel material.
No source commentary, branding, images, or layout is copied, and cover art remains a remote URL.

## Before anything is flipped

Two things have to be settled here. Neither is a setting, and both are one-way.

The first is BL-099. Its fifth acceptance item asks for legal review before the committed data tree
can be described as MIT-licensed, and it is deliberately unticked. The provenance record names that
review as the reason for the current state at `docs/DATA_PROVENANCE.md:11-13`, and sets out the four
questions such a review would have to answer. On 2026-08-15 the owner recorded being satisfied with
BL-099 and chose to move ahead without commissioning it. That is an accepted risk rather than an
answered question, it is written into the provenance document in those terms, and the acceptance
item stays unticked because no review took place. Nothing here is a legal opinion and that has not
changed.

The second was found on 2026-08-15 while removing Marvel's description text under BL-130, and it is
the sharper of the two because it expires. The working tree no longer carries that prose, but git
history does: 243 of the 246 commits then on `main` hold it, and 455 distinct descriptions and
89,460 characters are recoverable from them. A clone of a public repository carries the whole
history rather than only its tip, so the removal does not reach anybody who goes looking. The owner
decided on 2026-08-15 that the prose is to go, pending permission from a third party.

What that decision cannot be delivered by is a force-push, and this is the part to read before
planning one. The forge does not collect what a force-push orphans. Its own guidance says that after
rewriting and force-pushing, the commits may still be reachable in clones and forks, directly by
their SHA-1 in cached views, and through any pull request that references them, retrieved 2026-08-16
from `docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository`.
So the 116 pull requests here are the easiest door onto the residue rather than the cause of it, and
a repository with none would not be cleaned by a force-push either. The forge serves each a
permanent `refs/pull/<n>/head` that cannot be rewritten, deleted or forced past from here. Those
refs are not branches, so a clone never receives them and `npm run publication:surface` does not
scan them, and they are readable by anyone once the repository is public. Fetching all 116 on
2026-08-15 found 85 heads already unreachable from `main` and, under them, the same 455 distinct
descriptions and the same 89,460 characters. Rewriting the branches removes none of it. Four pull
requests closed without merging show that state in the present tense: their branches are gone, their
heads still fetch, and each carries between 396 and 508 descriptions.

So there are three routes, the flip closes all of them, and only one is known to work. Push the
rewritten history to a **new repository** and never publish this one, which reaches every copy and
costs the 116 pull request discussions, though not the code history. Ask the forge's **support** to
purge what is left, which is weaker than it sounds in both directions: its published policy says it
will not remove non-sensitive data and will assist on sensitive data only where the risk cannot be
mitigated by rotating a credential, and third-party marketing prose is neither, so this route
probably does not exist; and the same page says the removal takes the internal references that
render pull request diffs with it, so granted it would still cost the diffs on every closed pull
request. Or **accept** the 455 permanently. The rewrite itself is built and verified and is not the
hard part: it reproduces the current tip byte for byte, preserves every commit subject, author and
date, and leaves all 809 evidence anchors untouched. The rewritten `main` was then put through all
seven gates exactly as a fresh repository would run them, and passes every one: anchors 0 drifted,
963 tests, lint, counts, sizes, contrast and the publication gate all clean. That work is kept rather
than discarded, because it is the evidence for what the decision below was choosing between.

**The owner chose to accept, on 2026-08-16.** The 455 descriptions stay in this repository's history
and behind its pull request refs, and it is published as it stands rather than rebuilt somewhere
clean. The reasoning is recorded rather than left to be reconstructed: what is exposed is a third
party's marketing copy rather than anything private to anyone, the working tree and everything the
app serves are already clean of it, the only route that would remove it costs all 116 pull request
discussions and the review history in them, and the route that would have kept those is one the
forge's own published policy says it does not perform for material of this kind. The rewrite stays
built and unused, and the two paragraphs above stay as the evidence it was weighed against.

This decision is not retractable after publication, which is why it was taken before it rather than
carried into it. What would change it is a demand from the rights holder, and that is a takedown
route rather than a planning one: the working tree is already clean, so the remaining response would
be to make the repository private again and then run the new-repository route, which stays available
for exactly as long as somebody keeps a copy of the transform.

Everything below assumes both have been settled.

## Settings that only become available on the day

Three things this project wants are free on any public repository and cannot be turned on at all
today. Each was checked against the GitHub API rather than assumed, which is why each has a backlog
item recording a refusal rather than an omission.

Do them in this order. The first pair has a real dependency and the third does not.

1. **Secret scanning, and then push protection**, closing BL-089. Push protection depends on secret
   scanning, and asking for push protection on its own is accepted and quietly does nothing, which
   is the trap recorded at `SECURITY.md:140-146`. Turn on scanning first, confirm its alerts
   endpoint stops answering 404, and only then turn on protection.
2. **Private vulnerability reporting**, closing BL-096. This is the one with a user-visible
   consequence: until it is on, the security policy sends a reporter to a public issue.
3. **Branch protection on `main`**, closing BL-098. Both endpoints that would report the current
   rules answer 403 on this plan, so the state cannot be read today, let alone set. Verify after
   setting rather than assuming the write took.

One thing changes with nobody touching it. Every `required: true` in the issue forms is inert while
the repository is private and starts being enforced on publication, which is recorded with its
reasoning at `PRODUCT_BACKLOG.md:7114-7118`. The forms do not need editing. It is listed here
because a form that suddenly rejects a submission looks like a regression to whoever hits it first.
## The prose that stops being true

Each of these was a live statement about the present rather than a record of the past. The right
rewrite was a judgement about tone and was left to whoever made the change, so this table says what
became false rather than what was written instead. All nine were rewritten on 2026-08-16 under
BL-133, so the passages named below no longer say what this table says they said.

| Where | What it asserted before publication | Why publication broke it |
|---|---|---|
| `SECURITY.md:39-44` | Private reporting cannot be turned on here, so a reporter should open a public issue asking for a channel and put no detail in it | The fallback stops being the live route once BL-096 is on. The paragraph still needs its other half, for a reporter who does not find the option because it was never enabled |
| `SECURITY.md:140-146` | Secret scanning is not on and cannot be, with the exact refusal GitHub gives | Both halves of that become wrong once BL-089 is done, including the note that push protection accepts a request and changes nothing |
| `CONTRIBUTING.md:7-11` | Nobody outside can see the code, open an issue or send a change, so the guide describes contributing rather than reporting it | The whole paragraph is about a condition that has ended. It also points at the security policy's private route as a parallel case, so the two want editing together |
| `CODE_OF_CONDUCT.md:40-43` | There is no private channel to the maintainer, and GitHub's private reporting features are unavailable | This one asks for its own revision in its last sentence. Whether a private channel now exists is a decision, not an automatic consequence |
| `.github/ISSUE_TEMPLATE/config.yml:1-7` | Blank issues must stay on because the security policy's fallback is the live route rather than a spare one | The reason weakens, but read the rest of that comment before acting on it. Turning blank issues off would still leave a reporter with three forms that all ask for detail and no way to ask for a channel |
| `docs/DATA_PROVENANCE.md:11-13` | The open legal question is the reason this repository has not been published | Only edit this once the first section of this document is genuinely closed, and record what the answer was |
| `scripts/check-publication.mjs:2-5` | The gate's own opening comment states the repository is private | The gate keeps working and keeps being worth running. The comment describes a condition that has changed |
| `test/publication-gate.test.js:20-24` | The gate answers a question asked once, on the day someone publishes | Written for the day before. Worth a sentence saying the day happened, because the tests still defend the boundary afterwards |
| `.github/CODEOWNERS:5-8` | Code owner approval cannot be required, quoting GitHub's 403 and its "make this repository public" remedy | The obstacle is gone once step 3 below is done. The sentence before it, that the file routes nothing because there is one collaborator, is about headcount and stays true |

The nine rows above are the live passages outside the two records, and the records are the
exception. Ten of the twenty-one are in `PRODUCT_BACKLOG.md` and two more are in `CHANGELOG.md`.
Eleven of those twelve say what was true when a piece of work was delivered, and they are history
that must not be rewritten, for the same reason the dated tracking artifacts are not re-aimed:

- `PRODUCT_BACKLOG.md:6464-6477`, why secret scanning was left unticked, and what push protection
  does when asked for without it.
- `PRODUCT_BACKLOG.md:6878-6885`, why the private reporting task was left open.
- `PRODUCT_BACKLOG.md:6943-6945`, what the changelog entry beside it was corrected to say.
- `PRODUCT_BACKLOG.md:6966-6971`, why the contribution guide is written in the future tense.
- `PRODUCT_BACKLOG.md:6973-6979`, why the code of conduct offers no private channel.
- `PRODUCT_BACKLOG.md:7040-7046`, why the branch rules task was left open and could not be read.
- `PRODUCT_BACKLOG.md:7071-7076`, why blank issues stay enabled.
- `PRODUCT_BACKLOG.md:7114-7118`, why `required: true` collects nothing today.
- `PRODUCT_BACKLOG.md:9219-9224`, the three settings named as refused on this repository today.
- `CHANGELOG.md:3501-3512`, the released note that secret scanning cannot be turned on.
- `CHANGELOG.md:3514-3524`, the released note that the private channel is not switched on.

The twelfth was live and did have to change: the introduction at `PRODUCT_BACKLOG.md:30-42` listed
BL-089, BL-096 and BL-098 among the items whose acceptance could not be met, and once they were met
that sentence described a state that no longer held. It was rewritten with those three clauses
removed, together with BL-039's long-open task, which the same day closed, and with a clause added
for BL-130's provenance record, which is genuinely still open. Four removed and one added is why the
passage now cited there counts nine open tasks rather than twelve, and the arithmetic is worth
stating because 12 minus 3 also reaches 9 and would have been the wrong reason.

This document is not on its own list. It says in its own second section that three settings cannot
be turned on today, which publication falsified as surely as anything above, but a runbook is spent
by the event it describes and rewriting it would be pointless. It carries a dated stamp at the top
instead. The one thing that could not be left alone is its own `path:line` claims, which the
anchors gate holds live whether the document is spent or not, so those were re-aimed on the day and
the table header was put into the past tense to keep each claim true. Read the rest as dated.

## What the rewrites cost the evidence anchors gate

Read this before starting the edits above rather than after, because the cheaper version of that
work is only available while the edits are being made.

Nine files carry the ten live passages, and 54 citations in the evidence anchors lock point into
those nine. They do not all break, and which of them do is under the control of whoever writes the
replacements:

- 14 name a range overlapping a passage being rewritten. These break however careful anyone is,
  because the gate fingerprints the content of the lines a citation names and that content is the
  thing changing. One of them spans a whole file, the ownership file, so it breaks on any edit to
  that file at all.
- 39 sit after an edit in the same file and are otherwise untouched by it. These break only if the
  replacement is a different number of lines from the passage it replaced.
- 1 sits before every edit in its file and cannot be affected.

So the whole of the difference between a 14 anchor round and a 53 anchor one is whether each
replacement has the same line count as what it replaces. That is a free constraint on prose being
rewritten anyway, and it is worth taking.

Measured rather than reasoned, on the security policy, whose publication-conditional paragraph is
six lines and which carries a citation ninety lines below it. Replacing those six lines with six
different ones drifted two anchors, the passage's own and a wider range containing it. Replacing
them with eight drifted three, the third being that distant citation, which no edit had gone near.

One assertion in the suite defends this prose, and knowing which one is worth more than a surprise
red run. `test/intake-config.test.js:109-115` requires the security policy to contain the sentence
telling a reporter to open an issue saying only that they have a security report, and requires blank
issues to stay enabled, because the first is the stated reason for the second. That sentence sits
inside the first passage in the table above. So rewriting that paragraph either keeps the sentence
or changes the assertion in the same commit, and the row above argues for keeping it: the fallback
stops being the live route once BL-096 is on, but a reporter who does not find the option still
needs somewhere to land.

Nothing else in the suite holds these passages. Every assertion in it was matched against all ten,
and what comes back besides that one is comment-stripping helpers that match a `#` and assert
nothing about the prose. The near miss worth naming is the governance record's test, which reads the
security policy but names a sentence above the paragraph that changes, and that sentence stays true
after publication.

Then bless the round the way any round is blessed, reading each printed pairing against the claim
printed beside it. A round this size is exactly where that reading gets skipped.

## How the list was found, and how to check it

A passage belongs here when publication makes it false or takes away its reason. That rule is easy
to state and hard to search for, because the passages are written from both sides. Some say this
repository is private. Others quote GitHub refusing something and telling you to make the repository
public. A sweep keyed on one side misses the other, and that is not a hypothetical: the first
enumeration matched single lines against a pattern requiring the word "repository" and missed both
changelog entries, and the second read whole passages but still keyed on the private side and missed
five more, including the ownership file quoting the public-side phrasing verbatim.

So re-derive the list rather than trusting it:

```
git --no-pager grep -n -I -i -E "is (still )?private|private repositor|private reporting|is not public|not been published|make this (repository|one) public|repository public to enable|not available for this repository|Upgrade to GitHub Pro|while it is private|on (a|any) public repositor|visible to the public|cannot be (enabled|switched on|turned on)" -- . ":(exclude).copilot-tracking" ":(exclude)docs/anchors.lock.json" ":(exclude)docs/PUBLICATION_RUNBOOK.md"
```

Measured against the twenty-one above, that finds every one of them, on 42 matching lines across 12
files. The two files that are not on the list are false positives of a kind worth recognising: they
are sentences about the list rather than members of it, one in `README.md` and one in the comment on
the test that holds the security policy and the issue forms together. A block recording a defect
already fixed is the other shape to expect, and it stays true after publication.

That classification was half wrong, and a review caught it on the day rather than the search doing
so. The `README.md` hit is a sentence about this document, but it also asserts in the present tense
that passages here are true only while the repository is private and that three settings cannot be
switched on, which are claims about repository state and not about the list. It was rewritten with
the nine, making ten. The comment on the test is a genuine false positive and stands. The lesson is
the one this section already teaches, applied one level up: "a sentence about the list" is not a
safe category, because a sentence can be about the list and still assert the state.

Read every hit as a passage rather than as a line. Counting lines is what went wrong the first time.

## Verifying afterwards

The two publication gates answer questions about history and about what is advertised, not about
prose, so a clean run does not mean this list has been worked through.

```
git fetch --prune
npm run publication
npm run publication:surface
```

Run the surface gate after fetching, since it reads what the remote advertises and a stale copy
will report on branches that no longer exist. Then run the full set of checks the way any change
runs them, because six of the ten files above are documents the counts gate reads and the anchors
gate reads all ten.

The honest summary of this section: nothing in this runbook is enforced. The checklist is the
enforcement, which is the argument for writing it down before the day rather than during it.

## Post-publication content releases

The dated publication decision above stays historical, but its two gates remain release checks.
Source-linked catalog additions run both after the working tree is complete so a new card cannot
quietly advertise a private, stale, or unreachable source surface. Nine historical continuation
batches added thirty-three Comic Book Reading Orders cards containing 372 delivered issues and
brought the catalog to 134; that remains the dated record of those releases.

Later source-backed work brought the maintained catalog to 250 visible Reading Lists generated
from 173 source orders, including six MCU Prep guides and thirty-nine Comic Book Reading Orders
guides. The detailed current source and row inventory lives in
[Data provenance](DATA_PROVENANCE.md), so this runbook does not keep a second per-program ledger.

A catalog partition release keeps its aggregate source as an explicit noncatalog parent and emits
ordinary child Reading Lists only after the ledger, aggregate vector, generated path and child
overlap matrix all validate. Run the publication gates against the complete generated tree, confirm
the parent has no visible catalog row, and keep any existing saved parent list untouched.
