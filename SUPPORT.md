# Support

Where to take a question, a problem or a report, and which of them belong somewhere other than
here.

## Start with the troubleshooting section

Most problems people hit are one of five, and all five are answered in
[the troubleshooting guide](docs/RUNNING.md#troubleshooting): the port is already in use, Node.js is
not installed, the page is blank, the read button appears to do nothing, and reading progress has
apparently disappeared.

The last one is worth calling out because it is the most alarming and the least serious. Progress
is filed by your browser under the exact address you were using, port and hostname included, so
opening the app at a different address shows an empty tracker. Nothing has been deleted. Going back
to the original address brings it all back. [Always open the same
address](docs/RUNNING.md#always-use-the-same-address) explains why, and it is the single most useful
thing to know about this app.

Progress is also per browser and per profile. Opening the app in a browser you have not used with
it before will show it empty, and your other browser is untouched.

## Asking a question or reporting a problem

Open an issue on this repository. What helps most, in rough order:

- What you did, what happened, and what you expected instead.
- Whether any reading progress you had saved was affected.
- The address in the browser bar, copied exactly, port included.
- Your browser and its version.
- Anything red in the browser's developer console.

There is no other maintainer channel. There is no mailing list, maintainer chat or forum, and this
project is worked on in bursts, so a reply may take a while.

## Asking GitHub Copilot about the public project

The [project home](https://raymond-nassar.github.io/recap-page/) explains an optional GitHub Copilot
Space that answers questions from selected maintained project documents. It is AI-generated project
help, not a conversation with the maintainer, and its answers can be incomplete or wrong.

The home explains GitHub access, hosted processing, Chat retention and individual training controls
before the link. Recap Page sends no reading state to the Space. Do not paste progress, lists, notes,
backups, personal information or suspected vulnerability details into it. Use the public issue route
above for maintainer support and the private route below for security.

## A suspected security problem never goes in an issue

Read [the security policy](SECURITY.md) instead. It explains how to report privately and what
counts as a vulnerability in an app with no hosted backend and no accounts. The short version is
that anything which silently loses or corrupts saved reading progress is treated as a security
issue, and that a public report is a disclosure you cannot take back.

## Things that are somebody else's to fix

**Marvel's own services.** The Marvel Unlimited reader, `read.marvel.com`, `marvel.com`, your
subscription, and whether a particular comic is in the service at all. This app links out to those
and holds none of them, so it cannot affect them and cannot fix them. Take it to Marvel.

**The metadata database.** Covers, titles, publication dates and creator credits come from a
community project, the Marvel Metadata API, described in
[Data provenance](docs/DATA_PROVENANCE.md). Its availability, its correctness and its rate limits
are not this project's to fix. Two things are worth separating before you report anything about it:

- **An outage** looks like details failing to fill in while the app itself keeps working. That is
  deliberate: the app is written to degrade rather than break when the database is unreachable, and
  it shows a pending state rather than pretending. Waiting is usually the answer. If you want to
  check whether the app or the database is at fault from a source checkout, run `npm run contract`,
  which asks the live API directly and reports what it got. The packaged Windows download does not
  include this maintainer diagnostic.
- **Wrong or missing information for a specific issue**, where the database itself has it right, is
  worth reporting here, because that means this project copied it across wrongly.

The database can be self-hosted and the address the app uses is a setting, so if you run your own
mirror you can point the app at it.

**Comics published after 2025.** The bundled metadata snapshot ends there, so a later comic starts
without bundled details or a cover. That is a documented boundary, not a defect. The manual entry
form can look up factual details on Marvel Fandom when you ask it to and can preserve a pasted
Marvel Unlimited reader link. Report a problem when one of those explicit routes loses or changes
what you supplied; the absence of a newer comic from the bundled snapshot is working as intended.

## Asking for a change

[The planning Project](https://github.com/users/raymond-nassar/projects/1) lists active work and
links each item to the Issue that owns its reasoning, so it is worth a look before asking: the thing
you want may be on it already.

[The contributing guide](CONTRIBUTING.md) sets out what this project will decline whatever the
merits, which is a short list and a firm one. Reading it first saves everybody a round trip.

## Which version you have

**About this app** shows two numbers: the app version and the format of your saved data. Both are
worth quoting in any report, because without them a report is about an unidentifiable copy of the
app. A major version marks a substantial new product generation and is also required when saved
data changes in a way an older build cannot read. Release notes state whether progress remains
compatible. [The changelog](CHANGELOG.md) records what changed in each version.
