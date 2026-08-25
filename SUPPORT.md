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

There is no other channel. There is no mailing list, no chat and no forum, and this project is
worked on in bursts, so a reply may take a while.

## A suspected security problem never goes in an issue

Read [the security policy](SECURITY.md) instead. It explains how to report privately and what
counts as a vulnerability in an app with no server and no accounts. The short version is that
anything which silently loses or corrupts saved reading progress is treated as a security issue,
and that a public report is a disclosure you cannot take back.

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
  check whether the app or the database is at fault, run `npm run contract`, which asks the live
  API directly and reports what it got.
- **Wrong or missing information for a specific issue**, where the database itself has it right, is
  worth reporting here, because that means this project copied it across wrongly.

The database can be self-hosted and the address the app uses is a setting, so if you run your own
mirror you can point the app at it.

**Comics published after 2025.** These have no cover and no details, and the app says so where it
shows them. The snapshot the catalogue was built from ends there. That is a documented boundary,
not a defect, and the app has an entry form for filling those in by hand. A report that a 2026
issue has no cover will be closed as working as intended. A report about anything published in 2025
or earlier is worth filing.

## Asking for a change

[The planning Project](https://github.com/users/raymond-nassar/projects/1) lists active work and
links each item to the Issue that owns its reasoning, so it is worth a look before asking: the thing
you want may be on it already.

[The contributing guide](CONTRIBUTING.md) sets out what this project will decline whatever the
merits, which is a short list and a firm one. Reading it first saves everybody a round trip.

## Which version you have

The app shows two numbers in the side rail: the version it is, and the format your saved data is
in. Both are worth quoting in any report, because without them a report is about an unidentifiable
copy of the app. A major version number changing means an older build cannot read data saved by a
newer one, which matters here more than in most software, because your reading progress lives only
in your own browser and nothing can migrate it for you. [The changelog](CHANGELOG.md) records what
changed in each one.
