## In plain English

<!--
Write this for someone who does not know the codebase, and write it after the work rather than
from the plan, so it describes what actually shipped.

Name no file, no identifier, no command and no item id. If a file matters, say what it does.
Say what a person using the app would notice, and say so plainly when the answer is nothing.
Give the reason before the mechanism: what was wrong, why it was worth fixing, then what was
done about it. Four short paragraphs at most.

Delete this comment and write here.
-->

## What changed

<!--
One major feature per pull request. If you found something else worth doing, add it to the
project's list of planned improvements rather than to this branch.
-->

## Evidence

<!--
Ground each claim rather than recalling it. A claim about this codebase carries the file and the
line number it is true at, written the way the existing documents write them. A claim about
anything outside carries a link and the date you retrieved it.

Every one of those file-and-line references is checked automatically, by content rather than by
number, so re-aim any that your own change moved and read each one against the sentence that
cites it before accepting it.
-->

## Verified

<!--
Record numbers, not adjectives. Fill in what you ran and what it said.
-->

| Gate | Result |
|---|---|
| `npm run lint` |  |
| `npm test` |  |
| `npm run counts` |  |
| `npm run sizes` |  |
| `npm run spacing` |  |
| `npm run palette` |  |
| `npm run anchors` |  |
| `npm run publication` |  |
| `npm run contract` |  |

<!--
`npm run contract` calls a live third party and is deliberately outside CI, so run it by hand
before trusting a release. Record the revision beside any figure that is measured over the whole
history, because those go stale the moment you commit again.

If you added a test or a check, say how you watched it fail without your fix. A check that has
never been seen to fail is not evidence.
-->

## Provenance

<!--
Did this change add, regenerate or hand-edit anything under the committed data directory? If so,
say where each field came from and under what terms. Never commit comic image bytes; cover URLs
only. Never scrape marvel.com.

Did it add a dependency? Runtime dependencies stay at zero. Development tooling is allowed and
should be named here with the reason.

If neither applies, write "No data or dependency changes."
-->

## Follow-ups

<!--
Anything this deliberately leaves open, with the item id it was filed as. Review findings that
belong to a later item are routed, not looped: fix what is material here and file the rest.

CONTRIBUTING.md explains every heading above, and why each one is asked for.
-->
