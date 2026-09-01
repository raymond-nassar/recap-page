import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The network privacy claim is written in six places: a subtitle on Backup and settings, the
// About view's "Your data" section, the README, the security policy, the Cover art card and the
// About view's "Metadata and links only" card. Nothing joined them up, so each could be edited
// while reading only one sixth of what a reader ends up believing, and
// they drifted into disagreeing. The app said nothing is uploaded; the README said correctly that
// details and covers are downloaded; the policy named the downloads and said only that the hosts
// saw "that a request was made", which is the same understatement one level quieter.
//
// The absolute is the easy sentence to write and the hard one to keep true, because every new
// outbound request falsifies it silently. So this holds them to the same shape: name the
// promises that are kept, and name the requests that are made, in every place the subject comes
// up. It fails in both directions, which is the point, since deleting the qualification would
// otherwise read as tightening the promise.
//
// The three full statements carry both halves. The subtitle and the two cards are summaries
// with no room for the requests, so they are held to the absolutes alone. Only the subtitle had
// broken that half; the cards are here because they are where the claim is most natural to
// write, which review demonstrated twice by finding it half written in both.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// Prose as a reader sees it: comments and tags dropped, whitespace collapsed.
function prose(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function section(html, startsWith, endsWith) {
  const from = html.indexOf(startsWith);
  assert.notEqual(from, -1, `the markup must still carry ${startsWith}`);
  const to = html.indexOf(endsWith, from + startsWith.length);
  assert.notEqual(to, -1, `${startsWith} must still be followed by ${endsWith}`);
  return prose(html.slice(from, to));
}

// Markdown between two headings, with the closing heading asserted the way section() asserts its
// delimiter. Slicing on a heading that has been renamed silently returns the whole document, and
// a rule that is satisfied somewhere else in a 500-line file then passes for the wrong reason.
function between(md, startsWith, endsWith) {
  const from = md.indexOf(startsWith);
  assert.notEqual(from, -1, `the document must still carry ${startsWith}`);
  const to = md.indexOf(endsWith, from + startsWith.length);
  assert.notEqual(to, -1, `${startsWith} must still be followed by ${endsWith}`);
  return md.slice(from, to);
}

// Every surface that tells a reader where their data goes. The README is one of them: it is the
// document a new reader starts from and the only one they see before running anything. The
// security policy is another, and the README sends readers to it, so a weaker version of the
// claim there is the same defect in the place a careful reader checks second.
function surfaces() {
  const html = read('src/index.html');
  return [
    ['the About view', section(html, '<h3>Your data</h3>', '<h3>This build</h3>')],
    ['the README', between(read('README.md'), '### Your data stays with you', '## Run it on your computer')],
    ['the security policy', between(read('SECURITY.md'), '## What already reduces risk here', '- The development server')],
  ];
}

// The Backup and settings subtitle is a fourth site of the same claim, and it is where the
// absolute was actually found: it read "Nothing is uploaded." A subtitle has no room to name
// the requests, so holding it to the full shape would only force the qualification somewhere
// it cannot go. It is held to the absolutes instead, which is the half a one-line summary can
// break on its own, and the half it did break.
//
// The Cover art card is the fifth, and it is the natural home of the covers overclaim because
// it is the card that owns the switch. Review found the rule forbidding that claim could not
// reach it: the extraction stopped short of the card at both ends.
//
// The "Metadata and links only" card is the sixth, four cards above the corrected one on the
// same screen, and it said cover images "load directly from Marvel's own servers and can be
// switched off". Two predicates on one subject, the first about loading, so the second reads as
// though the loading is what stops. That is the implication this item spent three rounds
// removing from five other sentences, surviving in the one place nothing reached.
function claimSites() {
  const html = read('src/index.html');
  return [
    ...surfaces(),
    ['the Backup and settings subtitle', section(html, '<h1 id="data-h">', '</div></div>')],
    ['the Cover art card', section(html, '<h3>Cover art</h3>', '</div>')],
    ['the metadata and links card', section(html, '<h3>Metadata and links only</h3>', '</p>')],
  ];
}

// Kept, and stated as kept. Each is a promise the code actually honours: no account exists, no
// analytics or tracking is loaded, and neither read state nor notes is ever sent.
const PROMISES = [
  ['there is no account', /no account/i],
  ['there is no analytics or tracking', /no analytics|analytics or tracking|tracking of any kind/i],
  ['progress is never sent', /progress[^.]*never sent|never sent[^.]*progress/i],
];

// Made, and stated as made. A surface that lists the promises and omits these is the absolute
// this item was filed to remove, however carefully the promises themselves are worded. Naming
// the requests is not enough on its own: the README named both downloads and still told a
// reader their lists were never sent, so what the requests disclose has to be stated too.
//
// The disclosure rule needs the verb as well as the noun. "which issues" on its own is a phrase
// this app has every reason to use about itself, so a review showed the disclosing sentence
// could be deleted and the rule still met by a feature bullet describing what the app tracks.
//
// The series and creator row was added in round fifteen. All three surfaces enumerated the
// requests and left this one out, and two of them said in the same breath that "searching the
// catalog, series or creators is answered from files already on this machine", which is true of
// the search and not of the add that follows it. Adding a series pages the metadata API to
// completion, up to sixty requests, and is the longest run the app makes. An enumeration that
// reads as complete and omits the largest item is the defect this whole item exists to undo, so
// the clause is held by a rule rather than left as prose somebody can quietly drop.
const REQUESTS = [
  ['metadata is fetched', /(?:sends|asks|downloads)[^.]*(?:metadata API|comics database)/i],
  ['the app contacts the API on startup', /(?:starts|opening (?:the app|it))[^.]*reachable/i],
  ['covers are fetched from Marvel', /cover[^.]*Marvel'?s? (?:own )?image servers/i],
  [
    'adding a series or a creator fetches every issue',
    /adding[^.;]*(?:series|creator)[^.;]*(?:asks|sends|requests)[^.;]*every issue/i,
  ],
  [
    'opening a reader resolves a missing reader link',
    /(?:otherwise the (?:new|launch)\s+tab|opening an issue)[^.]*?(?:asks|may ask)[^.]*(?:metadata (?:API|service)|comics database)[^.]*(?:reader link|that link)/i,
  ],
  [
    'reader launch names both Marvel destinations',
    /(?:pressing (?:\*\*)?Read(?:\*\*)?|opening an issue)[\s\S]{0,300}(?:Marvel Unlimited|Marvel's reader)[\s\S]{0,300}marvel\.com/i,
  ],
  [
    'the requests disclose which issues',
    /(?:sees?|reveals?|discloses?)[^.]*(?:which issues|issues you are looking at|issue numbers)/i,
  ],
  // Added with BL-150, which put the first request to a host that is not Marvel and not the
  // metadata service anywhere in the app. A surface that enumerates the requests and omits an
  // entirely new third party is the same defect as omitting the largest one, so it is held by a
  // rule rather than left as prose. Both halves are required: naming the wiki without saying the
  // request waits for a press describes something automatic, which is not what was built and not
  // what Constraint 3 would allow.
  [
    'the hand-entry lookup sends the typed title to the Marvel Fandom wiki',
    /sends?[^.;]*(?:title|typed)[^.;]*Marvel Fandom wiki/i,
  ],
  [
    'that lookup happens only when the reader asks for it',
    /only (?:when|if) you press/i,
  ],
];

test('every surface that makes the privacy claim keeps the promises and names the requests', () => {
  for (const [where, text] of surfaces()) {
    for (const [what, said] of PROMISES) {
      assert.match(text, said, `${where} must still say ${what}`);
    }
    for (const [what, said] of REQUESTS) {
      assert.match(text, said, `${where} promises without saying ${what}, which is the absolute`);
    }
    assert.doesNotMatch(
      text,
      /GitHub[^.]*latest\s+(?:release|version)\s+number/i,
      `${where} still describes the retired GitHub update request`,
    );
  }
});

// The absolute itself, in the forms it has actually been written in here. "Nothing is uploaded"
// was on two screens while the README described the two downloads on the same subject, and
// "no server sees your reading progress" claims something the code cannot promise: hydration is
// ordered by what you have not read yet, so the order of those requests is derived from progress
// even though the progress itself never leaves. The last pattern is the README's own version,
// which named both downloads and then promised the lists were not sent, when the issue numbers
// in a list are precisely what a request for that issue's details or cover carries. It reads in
// both directions because the promise is as natural to write after the noun as before it, and a
// one-directional pattern let "your lists are never sent anywhere" through.
//
// The last is a different shape of the same error and the one this item shipped by accident: a
// setting was said to stop the cover requests, and at the time it did not. setCovers wrote a
// class and re-rendered, paintCoverUrl assigned img.src with no reference to the setting, and
// display: none does not cancel a fetch. Measured in Edge with the setting off from the first
// paint: 8 requests to i.annihil.us, the same 8 as with it on. BL-108 closed that by gating the
// assignment, so the sentence is now true and the instrument below runs in the other direction.
// It is written both ways round and with either name for the setting, because the card that owns
// the switch calls it "covers" and the About view calls it "cover art".
//
// The pronoun pair is there because a sentence-scoped pattern is evaded by a full stop. "Your
// lists are yours alone. They are never sent anywhere." is the same promise as the one that was
// removed, and the single-sentence forms miss it entirely.
const ABSOLUTES = [
  /nothing[^.]{0,30}\bis uploaded\b/i,
  /no server sees/i,
  /nothing (?:is )?(?:ever )?(?:sent|leaves)(?! is)/i,
  /(?:never sent|not sent|ever sent|never leaves?)[^.]*\blists?\b/i,
  /\blists?\b[^.]*(?:never sent|not sent|ever sent|never leaves?)/i,
  /\blists?\b[^.]*\.\s*(?:and )?(?:they|these|those)\b[^.]*(?:never sent|not sent|ever sent|never leaves?)/i,
];

// BL-108 inverted which of the two classes below the product belongs to, and left the instrument
// that separates them untouched. It was built when switching cover art off did not stop the cover
// requests, so a surface writing about the switch had to say they continued; the gate in
// paintCoverUrl now stops them, so a surface saying they continue is the false one. The detector
// is unchanged and is asked the same question. What changed is one assertion, the one applied to
// the shipped surfaces, which is why the corpora are named for what the instrument does with a
// sentence rather than for what was true of the product when it was written.
//
// Everything below this note is the design commentary as it was built, over thirteen rounds, and
// its "true", "false" and "lie" name the two classes as they stood then: "true" is
// ACCEPTED_SENTENCES, "false" is CAUGHT_SENTENCES. It is kept in that vocabulary deliberately.
// Every measurement it quotes, down to counts like "refuses 9" and "pardons 57 of the 121", was
// taken against those classes, and rewriting the words around the numbers would leave the numbers
// asserting a measurement nobody made.

// The covers claim needs a different instrument, and the two attempts before this one are the
// argument for its shape. Both looked for the lie, and both lost on the same two sides at once.
//
// A list of patterns for the lie was evaded six ways in a minute, by saying "downloads" or
// "fetches" instead of "requests", by putting a word between "no" and "requests", and by writing
// "switch it off". The same list rejected the most direct honest sentence there is, "the app
// still sends requests", because "ends?" matches inside "sends". Reading sentences instead of
// tokens did no better: requiring a cease-claim meant treating every "no", "nothing" and "never"
// near a request noun as a lie, which is how honest denials are written, so seven true sentences
// were reported as lies, "cannot stop the requests" among them. Pardoning a window that said
// "still" then let three lies through, because "the page still loads instantly" is true and has
// nothing to do with the covers.
//
// A check whose cheapest repair is to weaken the copy is worse than no check, and both attempts
// had that property. So this stops looking for the lie. A window that is about the covers switch
// must acknowledge that the requests continue. There is no lie vocabulary left to evade, since
// nothing is searching for one, and the repair to a refused sentence is to name the covers rather
// than to drop a true word. That is not quite the clean asymmetry it was once claimed to be: five
// of the twenty-five refusals below repair by moving a parenthetical, four to the end of the
// sentence and one to the front, which adds nothing and removes nothing. Two more repair by moving
// the assertion into the clause that names the covers, one by reordering a coordination and one by
// changing a predicate into an adverbial, and five more, the newest, repair by naming the covers a
// second time or by writing a semicolon where a conjunction stood. The refused sentences are listed
// with
// their repairs at the foot of this file rather than counted here, because a count in prose is a
// claim nothing checks. That list is a regression list and not a bound: it holds the refusals review
// has found, so that one of them cannot quietly start being accepted, and it is nowhere near all of
// them. Round nine wrote twenty-eight further true sentences in the register a maintainer editing
// this copy would use, and fourteen were refused, "hiding the covers saves no requests" among them.
// An absence of false positives is not a property any instrument of this kind will have, and a
// complete list of them is not one either.
//
// What this does not catch is a window that makes the cease-claim and acknowledges the requests
// in the same breath, which is a contradiction rather than an overclaim, and is a thing for a
// reader to catch. Saying otherwise would be the same overclaim one level up. Two passages of that
// shape are listed at the foot of this file as expected escapes, so closing one turns the suite red
// rather than passing silently.
//
// The other limit is that "a window about the covers switch" is itself an enumeration, and moving
// the enumeration from the lie to the switch does not abolish it. Review escaped the requirement
// four times by writing "without cover art" and "disable the images", which reached no pattern
// here, and twice more once "without" was added, by walking past its gap and by naming the images
// rather than the covers. Widening this list is close to monotone but not free: bare "images" and
// "pictures" are here because "disable the images" is how the escape was written, and they cost a
// true sentence that pairs one of them with a hiding word, which has to be reworded rather than
// qualified. "without" is deliberately not in that list for the same reason, and is matched only
// next to a covers term.
//
// "covers" is also a verb, and the collision is not theoretical: "a backup covers every list you
// keep, and nothing in it is hidden from you" was demanded an acknowledgement it has no business
// carrying. Every reading of it as our noun is followed by a preposition or a verb, so what follows
// tells the two apart. What follows the verb is an enumeration and not a rule, which is worth being
// plain about, because "covers everything you keep" and "covers what you keep" are outside the list
// below and are read as the noun. In the clause that makes the assertion that direction is the
// affordable one: a word missing here refuses a true sentence that then has to be reworded, rather
// than excusing a false one.
//
// This same list decides whether a passage is read as being about the covers switch at all, and
// there the direction inverts, which is the opposite of what a reader of the paragraph above would
// expect. A word present in it stops a window being examined: "hide the covers you have not read and
// Marvel is never asked for them" is a lie, and "you" excuses it before any of this is reached. Both
// are recorded as escapes at the foot of this file. Reading the noun a second way for window
// recognition alone catches them and was measured as refusing four true sentences, so the list stays
// shared and the cost of sharing it is written down rather than asserted away.
const NOT_OURS =
  '(?!\\s+(?:a|an|the|every|everything|everyone|all|anything|any|each|both|most|whatever|what|your|my|its|their|you|us)\\b)';
const COVERS = new RegExp(
  `\\b(?:cover art|cover images?|cover pictures?|artwork|images?|pictures?|cover|covers${NOT_OURS})\\b`,
  'i',
);
const TURNED_OFF =
  /\b(?:off|hidden|hide|hides|hiding|unchecked|unchecking|unticked|unticking|disable|disabled|disabling|suppress(?:ed|es|ing)?|no longer shown)\b/i;
// Thirty characters, not twenty: "without ever showing you the cover art" needs twenty-two, and
// review walked out through the gap at twenty. "the images" earns its place separately, because
// "without the images, no request goes out" is the switch and "a plain JSON file without images"
// is not, and the article is the only thing that tells them apart.
const WITHOUT_COVERS =
  /\bwithout\b[^.;]{0,30}\b(?:cover art|covers?|cover images?|cover pictures?|artwork|the images?|the pictures?)\b/i;
const SWITCHED =
  /\b(?:switch\w*|turn\w*|toggl\w*|uncheck\w*|untick\w*|disabl\w*|hid(?:e|es|den|ing))\b[^.]{0,40}\boff\b/i;
const CLEARED =
  /\b(?:clear|clears|cleared|clearing|uncheck\w*|untick\w*)\b[^.]{0,25}\b(?:checkbox|check box|box|tick)\b/i;

// The forms the truth is actually written in. A form missing here fails a true sentence, and the
// repair is to say it more plainly rather than to say less. That is the direction worth having,
// though it is not absolute: some refusals at the foot of this file repair by reordering.
//
// Every branch has to name a request, and the acknowledgement has to be about the covers. Neither
// is tidiness. Review pardoned three lies with a true clause about something else entirely sitting
// beside them, because "unchanged", "regardless" and "as before" carry no subject of their own:
// "switching cover art off stops them being requested, and your notes are unchanged" passed.
//
// Punctuation was tried as one rule for every branch and is the wrong instrument at that width,
// though the right one branch by branch. Measured against the 55 true sentences at the foot of this
// file, and against the coordinator list as it stands below rather than the seven words it held
// when this was first written, refusing a gap that crosses a comma everywhere refuses 6 of them,
// "the image is requested, regardless" among them, and ending every clause at a coordinator
// everywhere refuses 9. Both together refuse 10. No false sentence is pardoned by any of the three.
// What that cost buys has to be stated beside it, because leaving it out is what made the per-branch
// conclusion look free: the comma rule everywhere closes 7 of the 18 escapes recorded at the foot of
// this file, the coordinator rule everywhere closes 4, and both together close 8. So the wholesale
// forms are not pure loss, and the case for applying both per branch instead is that the per-branch
// form closes the same escapes for none of the cost, not that the wholesale form buys nothing.
// What separates the two cases is the subject: "your notes" is a different one, "regardless" is not
// a subject at all. So a branch whose halves are one assertion may cross neither mark, a branch
// whose other half carries no subject may cross both, and the tie is to what the clause is about.
const ASKED =
  '(?:requests?|requested|sends?|sent|fetch(?:es|ed|ing)?|downloads?|downloaded|asks?|asked|asking)';
const NOT_STOP =
  "(?:cannot|can't|can not|could not|couldn't|does not|doesn't|do not|don't|did not|didn't|will not|won't|would not|wouldn't)\\s+(?:stop|mean|prevent|reduce|change|halt|cancel)\\w*";
// The words that say nothing has changed divide in two, and the division decides how far each
// branch may reach. An adverbial carries no subject of its own, so it leans on the clause before
// it and the acknowledgement has to reach across a comma to find it: "the image is requested,
// regardless" is one assertion written in two pieces. A predicate carries its own subject, so
// reaching across a comma pairs a request word in one clause with a subject in another, which is
// two assertions read as one.
const ADVERBIAL_UNCHANGED = '(?:regardless|anyway|(?:exactly )?as before|all the same|no different)';
const PREDICATE_UNCHANGED = '(?:unchanged|continues?|carry on|carries on)';
// This branch stands alone, with no request word beside it, so it has to carry one itself. Left
// bare as "the same number", it pardoned "every list keeps the same number of issues".
const SAME_REQUESTS = '\\bthe same (?:number of )?(?:requests?|fetches|downloads?)\\b';
// Two gaps, not one. A branch whose halves are one assertion may not cross a clause end, and a
// comma is a clause end everywhere else in this file. Left able to cross one, "the tiles are
// still there, no cover is requested" put "still" in one clause and the request in the next, and
// the lie was read as its own acknowledgement. The adverbial branches keep the wider gap, because
// crossing a comma is the whole of what they are for.
const GAP = '[^.;]';
const TIGHT_GAP = '[^.;,]';
// Whether a coordinator ends a clause is decided per branch, by the same reasoning. A branch
// asserting something about a request asserts it of one coordinate clause, so "no cover is
// requested and the details are still fetched" is two claims and the second is the one being
// made. The adverbial branches are not, because "turn covers off and the app requests every one
// of them regardless" is a single claim written across a coordinator. "but" and "yet" are
// deliberately absent from the list: the shipped copy hangs its own acknowledgement off one.
const ACKNOWLEDGES = [
  [`\\bstill\\b${TIGHT_GAP}{0,40}\\b${ASKED}\\b`, true],
  [`\\b${NOT_STOP}\\b${TIGHT_GAP}{0,40}\\b${ASKED}\\b`, true],
  [`\\bwithout stopping\\b${TIGHT_GAP}{0,40}\\b${ASKED}\\b`, true],
  [`\\bno (?:reduction|change|fewer|difference)\\b${TIGHT_GAP}{0,40}\\b${ASKED}\\b`, true],
  [`\\b(?:nothing changes?|changes? nothing)\\b${TIGHT_GAP}{0,40}\\b${ASKED}\\b`, true],
  [SAME_REQUESTS, false],
  [`\\b${ASKED}\\b${GAP}{0,30}\\b${ADVERBIAL_UNCHANGED}\\b`, false],
  [`\\b${ADVERBIAL_UNCHANGED}\\b${GAP}{0,30}\\b${ASKED}\\b`, false],
  [`\\b${ASKED}\\b${TIGHT_GAP}{0,30}\\b${PREDICATE_UNCHANGED}\\b`, true],
  [`\\b${PREDICATE_UNCHANGED}\\b${TIGHT_GAP}{0,30}\\b${ASKED}\\b`, true],
];

// Which clause is doing the asserting. A trailing clause that makes its own assertion has to name
// the covers itself; one that is a bare adverbial hangs off the clause before it and takes that
// clause's subject. That is the difference between "no cover is requested, your notes are
// unchanged" and "the image is requested, regardless", which are identical to any rule written
// about the punctuation between them.
//
// Deciding that by looking for a finite verb was the obvious way round and it was the wrong way
// round. A finite verb is an open class, so a verb missing from the list made the trailing clause
// look adverbial, the subject was inherited from the lie's own half, and the lie passed. Nothing
// was refused to signal it. Review demonstrated it with "loads", "look", "survive" and "behaves",
// each of which had been caught by the instrument before. So the test is inverted: a trailing
// clause asserts unless it is one of the listed subjectless fragments. Now a fragment missing from
// the list refuses a true sentence, which is loud, repairable, and listed at the foot of this file.
//
// "unchanged" is deliberately not in that list, and it is the one entry where the two directions
// collide. "The requests for covers are, in fact, unchanged" and "no cover is requested, unchanged"
// have the same shape exactly: a head naming the covers and a bare "unchanged" behind a comma.
// Admitting it accepts the first and pardons the second. Refusing it costs the first, which is
// repaired by moving "in fact" to the front of the sentence.
//
// The reference to the covers has to be what the clause is about rather than any word inside it, and
// admitting the pronouns anywhere in the clause was the same mistake as the finite-verb list one
// section above, made in the other direction. A word present in an open list pardoned silently.
// With "them", "they", "these" and "those" read anywhere, "the details for them are still fetched"
// and "though these titles are unchanged" both counted as acknowledgements about the covers, and a
// two-word insertion that changed nothing about their falsehood turned recorded lies into passes.
// Seven shapes of that insertion are in the false list below, and the reference this replaced
// pardoned exactly those seven of the sixty-three entries the list then held and nothing else in it.
// Two of the seven are the entries filed there as evasions a wider reference would have opened, so
// the reference called narrow was opening them itself.
//
// Tying the pronoun to the head of the clause and leaving the noun readable anywhere then repeated
// the mistake a third time, in the half that had not been touched. Writing the antecedent out where
// the pronoun had been refused restored every pardon: "the details for the covers are still
// fetched" reads as an acknowledgement about the covers to any rule that only asks whether the word
// is in the clause, and it is a clause about the details. It reached both shipped cards. So the
// noun is read the same way the pronoun is. A covers noun counts unless every occurrence of it in
// the clause hangs off some other noun through a preposition, which is the shape of "the details
// for the covers" and not of "the requests for the covers": what the preposition attaches to
// decides it, and a word about requesting is the one thing it can attach to and still be about
// them. That word is a request word as a noun or as a finite verb, which is how the shipped copy
// writes it: "the requests for the covers" and "the app still asks for the image".
//
// Three things about that rule were wrong for a round each, and all three were found the same way,
// by someone writing the evasion the shape of the rule allows. The attachment was read as the first
// one in the clause rather than the nearest, so "the same number of requests for the covers"
// answered "number"; that was papered over by admitting "number" as a request word, which then
// pardoned "the number of covers is unchanged". The span between the preposition and the noun was
// written as a list of eighteen determiners, all of which the span had to be made of, so a single
// adjective walked through it on both shipped cards. And the word the covers hang off was read from
// the same list the acknowledgement is built from, which holds the participles, so writing "the
// details requested for the covers" gave the covers a request word to hang off and handed back every
// pardon the rule had just closed. Reading the nearest attachment fixes the first without the paper,
// writing the span as anything at all fixes the second, and reading only the forms that cannot be a
// past participle fixes the third.
//
// The prepositions are the whole closed class rather than the three that post-modify a noun most
// often. A sample of a closed class is the same defect as a sample of an open one when the class is
// short enough to write out, and "the details regarding the covers" is what a sample of three
// invites. Widening it costs two true sentences, "even with cover art off there is no reduction in
// requests" and "even without cover art the app still requests every cover". The span reaches to the
// clause end, so a preposition that opens its clause is read as the attachment of every covers word
// after it rather than only the one beside it, which is why the second sentence is refused even
// though its second covers word has no preposition in front of it at all. Ignoring a preposition
// that opens its clause would recover both and was measured as pardoning four evasions whose head
// noun carries no determiner, so the two sentences are recorded as refusals instead.
//
// Of the pronouns only "they" is admitted, and only at the head of the clause. "them" is never a
// subject in English; "these" and "those" are determiners as often as pronouns, and it was the
// determiner uses that carried the evasions. "they" is neither, so at the head of a clause it is a
// subject. But a subject is not a reference, and treating the one as the other pardoned "the
// details are separate, they are still fetched" and four more like it, where the clause before
// hands "they" an antecedent that is not the covers. So the antecedent is resolved: it is the
// nearest preceding clause that is about the covers, decided by the same rule the asserting clause
// is decided by, and where that clause is itself headed by "they" the walk continues, which is what
// the shipped metadata card needs, since it says "cover images ... they can be hidden, but they are
// still requested" across two links of that chain. That test was a second determiner list for one
// round, which is a second list to keep in step with the first, and it refused "the hidden covers
// load from Marvel, and they are still requested" while admitting "the list of covers is separate,
// and they are still fetched". A pronoun subject with no covers antecedent to find is refused,
// which is the loud direction.
//
// One shape is not closed and is recorded as an escape rather than guessed at: a covers word inside
// something that modifies a different head noun with no preposition to hang it off, "the details the
// covers carry are still fetched", which arrives in the asserting clause and in the antecedent of a
// "they" alike. Nothing in the punctuation or the word order distinguishes it from "hides the covers
// but does not stop them". Telling those apart needs to know that "hides" is a verb and "details" is
// a noun, which is parsing, and every list written here instead of parsing has been walked through
// within a round.
//
// "one" and "each" are excluded for a different reason: they are quantifiers, and this repository
// writes about lists with them. Leaving them in pardoned "no cover is requested, and each of your
// lists is unchanged". The price is one true sentence, "though each one is requested", repaired by
// writing "though each cover is requested".
//
// Walking left instead, so that a subject separated from its verb by a parenthetical could be
// found, was measured and rejected. "The covers, even when hidden, continue to be requested" is a
// real sentence and it is refused. But a leftward walk lends a subject across clause boundaries in
// both directions, and against this corpus it pardons 57 of the 121 false sentences while accepting
// 21 of the 25 refusals. A rule that recovers twenty-one true sentences by excusing fifty-seven
// false ones is the second instrument returning under a new name.
const COVERS_WORD = `(?:cover art|cover images?|cover pictures?|artwork|images?|pictures?|cover|covers${NOT_OURS})`;
const LEAD = '(?:and |but |though |although |yet |or |so |then |while |when |whereas |even )*';
// The same lookahead COVERS carries, spelled once and shared, for the same reason: "covers" is also
// a verb, and "the export covers what was downloaded anyway" was reading as a clause about the
// pictures. Two copies of that exclusion would be two lists to keep in step, which is the defect
// this file keeps paying for.
const COVERS_NOUN = new RegExp(`\\b${COVERS_WORD}\\b`, 'gi');
// Prepositions are a closed class, so this is the whole of it and not a sample of it. That
// distinction is the point: every list in this file that has been walked through was a sample of an
// open class, where the missing word is the evasion. Each of the fifty added to the three this
// replaced was measured on its own and then all together, and none of them refuses a true sentence,
// pardons a false one, closes a recorded escape, accepts a recorded refusal, breaks a repair or
// fails a shipped surface.
const PREPOSITION = [
  'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around', 'at', 'before',
  'behind', 'below', 'beneath', 'beside', 'besides', 'between', 'beyond', 'by', 'concerning',
  'covering', 'despite', 'down', 'during', 'except', 'for', 'from', 'in', 'inside', 'into', 'near',
  'of', 'off', 'on', 'onto', 'out', 'outside', 'over', 'past', 'regarding', 'since', 'through',
  'throughout', 'to', 'toward', 'towards', 'under', 'underneath', 'until', 'up', 'upon', 'with',
  'within', 'without',
].join('|');
// Whatever sits between the preposition and the covers word is anything at all short of a clause
// end, which is what the span can be, because this is only ever read inside a single clause and
// clauseAround has already cut it at the nearest of those three marks. Two narrower spellings were
// shipped and both were walked through. A list of eighteen determiners, all of which the span had
// to be made of, was defeated by one adjective: "the details for the hidden covers are still
// fetched" pardoned, on both shipped cards. Widening it to word characters was defeated by a
// character rather than a word, and that failure is the worse of the two because it is silent. A
// bracket, a quotation mark, a hyphen inside the noun or the markdown emphasis that between()
// hands over unparsed all made the pattern match nothing, so hangsOff returned null, and null is
// read here as "hangs off nothing at all", which is the pardoning answer. The span nothing could
// read was the one span that excused itself.
const HUNG_OFF = new RegExp(`\\b(\\w+)\\s+(?:${PREPOSITION})\\s+(?=[^.;,]*$)`, 'gi');
// What it hangs off has to be a word about requesting, as a noun or as a finite verb, because the
// shipped copy writes it both ways: "the requests for the covers" and "the app still asks for the
// image" are acknowledgements, and "the details for the image are still fetched" is not.
//
// This is deliberately not the list the acknowledgement itself is built from, though it was for a
// round. A past participle is the one form that can post-modify the head noun in front of it, so
// admitting the participles wholesale hands the evasion back the word it was closed with: in "the
// details requested for the covers are still fetched" the covers hang off "requested", and the
// clause about the details reads as one about the covers again.
//
// Refusing every participle instead was the round after that, and it was too much. English writes
// the truth in the passive, and "a request is still sent for each cover" is refused by a rule that
// only knows finite forms. What separates the two is what stands in front of the participle: a
// form of "be" makes it the verb of a passive, and a request noun makes it a modifier of something
// that is itself a request. "the details requested" has neither, which is why it stays closed.
// Four true sentences are still refused by this and are recorded at the foot of the file, because
// "the bytes fetched for the covers are unchanged" and "the details requested for the covers are
// still fetched" have one shape between them and no rule here can take one and leave the other.
const FINITE_REQUEST = /^(?:requests?|sends?|fetch(?:es)?|downloads?|asks?)$/i;
const PARTICIPLE_REQUEST = /^(?:requested|sent|fetched|downloaded|asked)$/i;
const BE_BEFORE = /\b(?:is|are|was|were|be|been|being)\s+(?:\w+\s+){0,2}$/i;
const REQUEST_NOUN_BEFORE = /\b(?:requests?|fetches|downloads?)\s+$/i;
function isRequestWord(word, before) {
  if (FINITE_REQUEST.test(word)) return true;
  if (!PARTICIPLE_REQUEST.test(word)) return false;
  return BE_BEFORE.test(before) || REQUEST_NOUN_BEFORE.test(before);
}
const THEY_HEAD = new RegExp(`^\\s*${LEAD}they\\b`, 'i');

// The nearest attachment, not the first. "The same number of requests for the covers" attaches the
// covers to "requests", and reading the first attachment instead answers "number", which counts
// things rather than asks for them. Taking the nearest is why "number" is no longer admitted as a
// request word: it was there to paper over the first-match reading, and it pardoned "the number of
// covers is unchanged".
function hangsOff(before) {
  const scan = new RegExp(HUNG_OFF.source, 'gi');
  let nearest = null;
  for (let hit = scan.exec(before); hit; hit = scan.exec(before)) {
    nearest = { word: hit[1], before: before.slice(0, hit.index) };
  }
  return nearest;
}

function coversNamed(clause) {
  const scan = new RegExp(COVERS_NOUN.source, 'gi');
  for (let hit = scan.exec(clause); hit; hit = scan.exec(clause)) {
    const noun = hangsOff(clause.slice(0, hit.index));
    if (noun === null || isRequestWord(noun.word, noun.before)) return true;
  }
  return false;
}

// A coordinator that ends a clause leaves the coordinator itself behind as a segment, and a
// segment holding nothing but a joining word names nothing. Read as a clause it is not about the
// covers, so the backwards walk for what "they" refers to stops on it and answers no. Skipping it
// is only correct where the coordinator was treated as a clause end in the first place, which is
// why the branch decides this too rather than the walk deciding it for every branch.
const JOINER_ONLY = /^\s*(?:and|or|so|but|yet|although|though|while|whereas)?\s*$/i;

function theyMeansCovers(before, skipJoiners) {
  let clauses = before.split(/[.;,!?]/).filter((part) => part.trim() !== '');
  if (skipJoiners) clauses = clauses.filter((part) => !JOINER_ONLY.test(part));
  for (let i = clauses.length - 1; i >= 0; i -= 1) {
    if (coversNamed(clauses[i])) return true;
    if (!THEY_HEAD.test(clauses[i])) return false;
  }
  return false;
}

function aboutCovers(clause, before, skipJoiners) {
  return coversNamed(clause) || (THEY_HEAD.test(clause) && theyMeansCovers(before, skipJoiners));
}
const ADVERBIAL_ONLY =
  /^\s*(?:and |but |though |although |yet |or |so |even )*(?:regardless|anyway|(?:exactly )?as before|all the same|no different|as always|in fact|even so|either way)\s*$/i;
const CLAUSE_BREAK = /[.;,]/;
// The words that end a clause. Review re-joined six closed lies with a conjunction outside the
// original seven and every one pardoned again, which is this file's recurring failure: a rule
// resting on a list somebody wrote out by hand. The list is longer now, and extending it to the
// subordinators was measured as completely free against the corpus below and the six shipped
// surfaces: 0 true sentences refused, 0 false pardoned, 0 escapes closed, 0 repairs broken. It
// takes 26 of the 40 variants review built. "but" and "yet" would take 6 more and cannot be
// added: the shipped About-view sentence hangs its own acknowledgement off "but", and it fails.
// Those 6, and 8 more where the trailing adverbial keeps its wider gap by design, are recorded as
// escapes at the foot of this file rather than left unsaid.
const COORDINATOR =
  /\b(?:and|or|so|although|though|while|whereas|because|since|when|whenever|if|unless|after|before|until|nor|whilst|plus|then)\b/;

function clauseMarks(text, coordinatorEnds) {
  const marks = new Set();
  for (let i = 0; i < text.length; i += 1) if (CLAUSE_BREAK.test(text[i])) marks.add(i);
  if (!coordinatorEnds) return marks;
  const scan = new RegExp(COORDINATOR.source, 'gi');
  for (let hit = scan.exec(text); hit; hit = scan.exec(text)) {
    for (let i = hit.index; i < hit.index + hit[0].length; i += 1) marks.add(i);
  }
  return marks;
}

function clauseAround(text, index, marks) {
  let start = index;
  while (start > 0 && !marks.has(start - 1)) start -= 1;
  let end = index;
  while (end < text.length && !marks.has(end)) end += 1;
  return { clause: text.slice(start, end), before: text.slice(0, start) };
}

function acknowledges(text) {
  for (const [source, coordinatorEnds] of ACKNOWLEDGES) {
    const marks = clauseMarks(text, coordinatorEnds);
    const scan = new RegExp(source, 'gi');
    for (let found = scan.exec(text); found; found = scan.exec(text)) {
      const head = clauseAround(text, found.index, marks);
      const tail = clauseAround(text, found.index + found[0].length - 1, marks);
      const asserting =
        tail.clause !== head.clause && !ADVERBIAL_ONLY.test(tail.clause) ? tail : head;
      if (aboutCovers(asserting.clause, asserting.before, coordinatorEnds)) return true;
    }
  }
  return false;
}

function aboutTheSwitch(window) {
  return (
    (COVERS.test(window) && TURNED_OFF.test(window)) ||
    SWITCHED.test(window) ||
    CLEARED.test(window) ||
    WITHOUT_COVERS.test(window)
  );
}

// Windows of two sentences are read as well as single ones, because a full stop evaded the
// lists promise the same way. The acknowledgement is looked for in the neighbouring sentences
// too: "Switch covers off and every cover becomes a tile. The image is still requested." is a
// perfectly ordinary way to write it, and demanding both halves of one sentence would fail it.
function unacknowledged(text) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (let i = 0; i < sentences.length; i += 1) {
    for (const j of [i, i + 1]) {
      if (j >= sentences.length) continue;
      const window = sentences.slice(i, j + 1).join(' ');
      const context = sentences.slice(Math.max(0, i - 1), j + 2).join(' ');
      if (aboutTheSwitch(window) && !acknowledges(context)) return window;
    }
  }
  return null;
}

// The same instrument, asked the same question, with the other answer now being the defect.
// BL-108 made the switch stop the requests, so a surface saying they continue is the false claim
// and the rule that used to demand that sentence would now demand a lie.
//
// This reads the two-sentence window rather than the widened context that `unacknowledged` reads.
// The reason is a bound on damage, not a rescue: measured against the six shipped surfaces, a
// widened variant of this check reports clean on all six, exactly as this one does, so widening
// would not fail anything today. What it would do is let a conviction reach further. A neighbour
// can convict, and does: 15 of the 18 recorded escapes below are caught here, because a second
// sentence carrying "still" supplies the acknowledgement for a first sentence that is about the
// switch. The ordinary truth that covers are requested as they appear is not that neighbour and
// cannot be, since it trips neither half. Two sentences is as far as a conviction may reach.
function claimsRequestsContinue(text) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (let i = 0; i < sentences.length; i += 1) {
    for (const j of [i, i + 1]) {
      if (j >= sentences.length) continue;
      const window = sentences.slice(i, j + 1).join(' ');
      if (aboutTheSwitch(window) && acknowledges(window)) return window;
    }
  }
  return null;
}

test('no surface reinstates an unqualified claim that nothing is sent', () => {
  for (const [where, text] of claimSites()) {
    for (const absolute of ABSOLUTES) {
      assert.doesNotMatch(text, absolute, `${where} must not claim ${absolute}`);
    }
    assert.equal(
      claimsRequestsContinue(text),
      null,
      `${where} says the covers are requested with cover art switched off, which BL-108 made false`,
    );
  }
});

// The narrow promises are still allowed to be absolute, because they are true without
// qualification: a theme choice and a reading position genuinely never go anywhere. Losing this
// would make the rule above look satisfiable by deleting the promises instead of qualifying the
// claim, which is the failure it exists to prevent.
test('a promise about one thing may still be absolute, and one still is', () => {
  const html = read('src/index.html');
  const theme = section(html, '<h3>Theme</h3>', '<h3>Metadata source</h3>');
  assert.match(theme, /never sent anywhere/i, 'the theme setting genuinely never leaves');
  assert.doesNotMatch(theme, /nothing is uploaded/i, 'but it is a promise about the setting only');
});

// The corpus. Everything above is an instrument, and an instrument nobody can re-run is an
// assertion. These four lists were built by thirteen rounds of review trying to break the rule, and
// until now they lived in a scratch file outside the repository while both the changelog and the
// backlog said a proof would disagree with anyone who closed an escape. Nothing could. They are
// here now, so the claim is true and the counts in those documents are derived rather than
// remembered.
//
// Two of the lists record costs rather than successes, and they are the point of the exercise. A
// check that reports only what it catches is the one that grew the overclaims this item exists to
// undo.

// Every one of these must pass the instrument: each either acknowledges that the covers are
// requested or is not about the covers switch at all. Twenty-four are the repaired forms of
// refusals below. Eight must never be treated as being about the covers switch at all, four of
// them because they use "covers" as an ordinary verb. Since BL-108 the acknowledging entries are
// sentences a shipped surface may no longer write, which changes nothing about what it owes them;
// the eight make no claim about requests and a surface may still write those freely.
const ACCEPTED_SENTENCES = [
  'Turning covers off does not mean nothing is requested.',
  'Switch covers off and nothing changes: every cover is requested exactly as before.',
  'Even with cover art off there is no reduction in requests for the covers.',
  'Turning cover art off changes nothing about what is requested.',
  'Switching cover art off cannot stop the requests.',
  'Switch covers off and the app still sends requests for every cover.',
  'With cover art off the app still sends the same requests.',
  'Switch covers off and every cover becomes a plain typographic tile, but the image behind it is still requested.',
  'Cover images load directly from Marvel\u2019s own servers. They can be hidden, but they are still requested.',
  // The antecedent of "they" is decided by the rule the asserting clause is decided by. A determiner
  // list stood in for that rule for one round and refused this, because "hidden" is not a determiner.
  'The hidden covers load from Marvel, and they are still requested.',
  'Cover images load directly from Marvel\u2019s own servers. They can be hidden, and hiding the covers changes nothing about what is requested.',
  'switching cover art off hides the covers but does not stop them being requested',
  'Show cover art',
  'Covers are loaded straight from Marvel\u2019s own servers using the address the metadata API reports.',
  'Turn covers off and the app requests every one of them regardless.',
  'Hiding the covers does not prevent the requests.',
  'Switch covers off and the app requests every one of them anyway.',
  'Without cover art the app still requests every cover.',
  'Cover art is requested from Marvel\u2019s image servers as it appears, so those servers see which issues are on screen; switching cover art off hides the covers but does not stop them being requested.',
  'Switch covers off and every cover becomes a tile. The image is requested, regardless.',
  'Switch covers off and every cover becomes a tile. The image is requested, as before.',
  'Switch covers off and every cover becomes a tile. The image behind it is requested, exactly as before.',
  'Turn cover art off and the app still asks for the image.',
  'Turn cover art off and the requests to Marvel\u2019s image servers continue.',
  'Switch covers off and every cover becomes a tile. The image is requested although you never see it, exactly as before.',
  'Switch covers off and every cover becomes a tile. The image is requested, though hidden, as before.',
  'Switch covers off and nothing on screen is a picture; the requests for the covers are unchanged.',
  'Switch covers off and every cover becomes a tile, but the same requests for covers are made.',
  'Switch covers off and every cover becomes a tile, but the same number of requests for covers goes out.',
  'Switch covers off and no cover is shown, though each cover is requested exactly as before.',
  'Switch covers off and every cover becomes a tile. In fact, the requests for covers are unchanged.',
  'switching cover art off hides the covers, and every cover is requested regardless.',
  'The covers continue to be requested, even when hidden.',
  'Covers are requested regardless, whether shown or hidden.',
  'Cover art is still requested once you switch it off.',
  'The image behind each tile is requested exactly as before, hidden or not.',
  // The passive. English writes this truth in it more naturally than in any other voice, and for
  // one round the rule that closed the "details requested for the covers" evasion refused all of
  // it. These three are readmitted by what stands in front of the participle rather than by the
  // participle itself.
  'With cover art off, a request is still sent for each cover.',
  'Cover art is hidden, but the requests sent for the covers are unchanged.',
  'Switch cover art off, and the requests sent for the covers are unchanged.',
  // The repaired forms of the six refusals added in the same round. The first four name a request
  // where the refused form named its object; the last two put the assertion about the requests in
  // the clause that carries it.
  'Turn cover art off, and the requests for the covers are unchanged.',
  'Switch covers off, and the request for every cover is unchanged.',
  'Hide the covers, and the download for each cover is unchanged.',
  'With covers hidden, the requests for the covers are still sent.',
  'Switch covers off and every cover becomes a tile, but the traffic to Marvel is unchanged and the image is requested.',
  'Switch covers off and every cover becomes a tile. The image is requested, exactly as before.',
  // The repaired forms of the four refusals the wider coordinator list brought with it. Each moves
  // the assertion into a clause that names the covers itself, which is what the rule asks for; the
  // fifth of that round repairs to a sentence already in this list, the shipped one with "but".
  'Switch covers off and the tiles stay. The covers are hidden, and every cover is still requested.',
  'Switch covers off and the tiles stay. Cover art is hidden, and each cover is still requested.',
  'Turn cover art off and the images are hidden; every cover is still requested.',
  'Switch covers off and every cover is hidden, though each cover is still requested.',
  'A backup is a plain JSON file without images.',
  'The tracker works without pictures if you prefer.',
  'A backup covers every list you keep, and nothing in it is hidden from you.',
  'A backup covers everything you keep, and nothing in it is hidden from you.',
  'A backup covers what you keep, and nothing in it is hidden from you.',
  'The export covers anything you have hidden.',
];
// Every one of these must be caught. Each claims or implies that switching the covers off stops
// the requests, and says nothing about the requests continuing. Grouped by the review round that
// produced them, because the grouping is the evidence that each repair was needed rather than
// imagined. Since BL-108 the claim they make is the true one, and they are still the class the
// instrument must separate, which is the whole reason it survived the change.
const CAUGHT_SENTENCES = [
  'Switching cover art off stops the downloads.',
  'Turning cover art off stops the fetches.',
  'Cover art off means no cover requests.',
  "Switch covers off and Marvel's servers are never asked for them.",
  'Switch it off and the requests stop.',
  'Cover art off means nothing is downloaded.',
  'You can switch covers off. Then nothing is requested.',
  'Toggle covers off and the images are no longer fetched.',
  'With cover art off the fetching ceases.',
  'Switching covers off prevents the loading.',
  'Switch covers off and no cover is requested; the page still loads instantly.',
  'Turn covers off and no cover is ever requested, so the list still loads faster.',
  'Unchecking Show cover art means the images are never requested.',
  'Clear the checkbox and no cover is downloaded.',
  'With cover art disabled, no request is made.',
  'Hide the covers and Marvel is never asked for them.',
  'Switch covers off to save bandwidth.',
  'Turning cover art off keeps Marvel from seeing which issues you open.',
  'Without cover art, every cover becomes a plain typographic tile and nothing is requested.',
  'Disable the images and nothing is downloaded.',
  'Cover images load directly from Marvel\u2019s own servers. Without cover art none is requested.',
  'Without cover art, no cover images are downloaded.',
  'Switch covers off and no cover is requested. The address stored is unchanged.',
  'switching cover art off stops them being requested, and your notes are unchanged',
  'Turning cover art off stops the covers being downloaded, and your lists are unchanged.',
  'Switch covers off and nothing is requested. There is no change to your lists.',
  'Switch covers off and nothing is requested. Your lists open exactly as before.',
  'Switch covers off and nothing is requested. Your progress is kept regardless.',
  'Switch covers off and nothing is requested. The tiles look fine anyway.',
  'Switch covers off and nothing is requested. Switching it does not change what you have saved.',
  // A true clause about the metadata requests, pardoning a false one about the covers. Closed by
  // requiring the acknowledgement to be about the covers.
  'Switch covers off and no cover is requested; the details are still fetched.',
  'switching cover art off stops them being requested. The details are still fetched either way.',
  'Turning cover art off stops the covers being requested. The details are still downloaded.',
  // Comma splices and coordinators, which no rule about punctuation ever reached.
  'Switch covers off and no cover is requested, your notes are unchanged.',
  'Switch covers off and no cover is requested, the address stored is unchanged.',
  'Switch covers off and no cover is requested, so the address stored is unchanged.',
  'Switch covers off and no cover is requested. Every list keeps the same number of issues.',
  // The evasions a wider reference would have opened, kept shut by the narrow one.
  'Switch covers off and no cover is requested; the requests to the metadata service are unchanged.',
  'Switch covers off and no cover is requested, though the requests for titles are unchanged.',
  // The same two, and five more of their shape, with a covers pronoun dropped into a clause that is
  // about something else. Every one of these passed while the reference read the whole clause for a
  // pronoun, because presence was being taken for subjecthood. "them" is the object of a preposition
  // in three of them, and "these" and "those" are determiners on a non-covers noun in three more, so
  // in none of those six does the pronoun refer to the covers at all. The seventh is why "they" is
  // admitted only at the head of a clause and not merely inside one: in "the details they carry" it
  // is the subject of a relative clause whose head noun is the details.
  'Switch covers off and no cover is requested; the details for them are still fetched.',
  'Switch covers off and no cover is requested, your notes about them are unchanged.',
  'Turning cover art off stops the covers being downloaded, and your lists of them are unchanged.',
  'Switch covers off and no cover is requested; these requests to the metadata service are unchanged.',
  'Switch covers off and no cover is requested, though these titles are unchanged.',
  'Switch covers off and no cover is requested, though those details are unchanged.',
  'Switch covers off and no cover is requested; the details they carry are still fetched.',
  // Two escapes through "without", one past the twenty-character gap and one past the list.
  'Without ever showing you the cover art, nothing is requested.',
  'Without the images, no request goes out to Marvel.',
  // Trailing clauses whose verb was missing from the finite-verb list this round deleted. Every
  // one was caught by the instrument two rounds ago and pardoned by its replacement, which is why
  // the default is now the other way round.
  'Switch covers off and no cover is requested, and the page loads exactly as before.',
  'Switch covers off and no cover is requested, and your saved lists look no different.',
  'Switching cover art off stops them being requested, and your notes survive unchanged.',
  'Turning cover art off stops the covers being requested, and the reader link behaves exactly as before.',
  // Quantifiers read as covers pronouns. This repository writes about lists with "each".
  'Switch covers off and no cover is requested, and each of your lists is unchanged.',
  'Switch covers off and no cover is requested, each list is unchanged.',
  'Switch covers off and no cover is requested; the details are still fetched for each issue.',
  // Bare trailing fragments. Five use words that are deliberately not in ADVERBIAL_ONLY, so the
  // fragment is read as making its own assertion, finds no covers word in itself and is caught. Two
  // use words that are in it, "in fact" and "either way", and are caught for a different reason: the
  // acknowledgement pattern cannot complete a match on either of them. The rest of that list has no
  // entry here because there is nothing to write: every one of those words does pardon this shape,
  // and the seven forms are recorded as escapes at the foot of this file.
  'Switch covers off and no cover is requested, hidden.',
  'Switch covers off and no cover is requested, hidden or not.',
  'Switch covers off and no cover is requested, though hidden.',
  'Switch covers off and no cover is requested, whether shown or hidden.',
  'Switch covers off and no cover is requested, unchanged.',
  'Switch covers off and no cover is requested, in fact.',
  'Switch covers off and no cover is requested, either way.',
  // Recorded as an unclosable escape for two rounds, on the reasoning that binding the
  // acknowledgement to a covers noun would convict the shipped copy. Admitting the pronouns
  // alongside the nouns convicts none of it, and this is caught.
  'Switch covers off and no cover is requested, with the address stored unchanged.',
  // The noun half of the same evasion, found the round after the pronoun half was closed. Writing
  // the antecedent out where the pronoun had been refused restored every pardon, because a rule
  // that only asks whether the word is in the clause cannot tell "the details for the covers" from
  // "the requests for the covers". The first three are those rewrites; the fourth reached both
  // shipped cards before this round.
  'Switch covers off and no cover is requested; the details for the covers are still fetched.',
  'Switch covers off and no cover is requested, your notes about the cover art are unchanged.',
  'Turning cover art off stops the covers being downloaded, and your lists of the images are unchanged.',
  'Switch covers off and no cover is requested; the metadata for the covers is still fetched.',
  // A covers noun is also a verb, and the verb reading was pardoning a clause about an export.
  'Switch covers off and no cover is requested; the export covers what was downloaded anyway.',
  // A clause-initial "they" whose antecedent is not the covers. Reading subjecthood as reference
  // pardoned all three: the nearest clause head is the details, the metadata service and the notes
  // in turn, and in none of them do the pictures appear at all.
  'Switch covers off and no cover is requested. The details are separate, they are still fetched.',
  'Switch covers off and no cover is requested. The metadata service is untouched, they are unchanged.',
  'Switch covers off and no cover is requested. Your notes are stored locally, they are unchanged.',
  // A determiner list stood between the preposition and the covers word for one round, and required
  // the whole of that span to be made of determiners. One adjective, one possessive, one numeral or
  // one quantifier walked through it, and the first four of these reached both shipped cards. The
  // span is now written as plain words, so what the covers hangs off is read the same way whatever
  // modifies it.
  'Switch covers off and no cover is requested; the details for the hidden covers are still fetched.',
  'Switch covers off and no cover is requested; the details for Marvel\u2019s covers are still fetched.',
  'Switch covers off and no cover is requested; the details for those two covers are still fetched.',
  'Switch covers off and no cover is requested; the metadata for the hidden covers is still fetched.',
  'Hide the covers and Marvel is never asked for them; the details for the remaining images are still fetched.',
  'With cover art off no image is requested, though the records for each hidden cover are still fetched.',
  'Cover art off means no cover requests; the entries for those two covers are still downloaded.',
  // "number" was admitted as a request word to cover "the same number of requests for the covers",
  // which the first-match reading answered wrongly. Reading the nearest attachment answers
  // "requests" there and leaves these three convicted.
  'Switch covers off and no cover is requested, the number of covers is unchanged.',
  'Switch covers off and no cover is requested, and the number of covers is unchanged.',
  'Turn covers off and nothing is downloaded, the number of images is unchanged.',
  // Three prepositions were read as post-modifying a noun, which is a sample of a closed class and
  // so an evasion is just a fourth preposition. The whole class is read now.
  'Switch covers off and no cover is requested; the details regarding the covers are still fetched.',
  'Switch covers off and no cover is requested; the row in the table listing covers is still fetched.',
  'Switch covers off and no cover is requested; the notes beside each cover are still fetched.',
  'Switch covers off and no cover is requested; the record against every cover is still downloaded.',
  // A head noun with no determiner in front of it. Ignoring a preposition that opens its clause
  // would have saved two true sentences, and was measured as pardoning these four instead, so the
  // two are recorded as refusals at the foot of this file rather than bought with them.
  'Switch covers off and no cover is requested; details for the covers are still fetched.',
  'Switch covers off and no cover is requested. Details for the covers are still fetched.',
  'Switch covers off and no cover is requested. Metadata about the covers is still fetched.',
  'Switch covers off and no cover is requested. Records for each hidden cover are still downloaded.',
  // The antecedent of "they" was read with a determiner list of its own, a second list to keep in
  // step with the first. It is read with the same rule as the asserting clause now.
  'Switch covers off and no cover is requested. The list of covers is separate, and they are still fetched.',
  'Switch covers off and no cover is requested. The notes about the covers are separate, and they are still fetched.',
  'Switch covers off and no cover is requested. The records for each cover are separate, and they are still fetched.',
  // What the covers hang off was read from the same list the acknowledgement is built from, which
  // includes the participles. A participle is what post-modifies the head noun, so inserting one in
  // front of the preposition made the covers hang off a request word again and handed back every
  // pardon the attachment rule had just closed. The first four are the recorded evasions directly
  // above with one word added.
  'Switch covers off and no cover is requested; the details requested for the covers are still fetched.',
  'Switch covers off and no cover is requested; the metadata requested for the hidden covers is still fetched.',
  'Switch covers off and no cover is requested; the details sent for the covers are still fetched.',
  'Switch covers off and no cover is requested; the details fetched for the covers are still fetched.',
  'Switch covers off and no cover is requested; the details downloaded for the covers are still fetched.',
  'Switch covers off and no cover is requested; the questions asked about the covers are still sent.',
  'Switch covers off and no cover is requested. The records requested for each cover are separate, and they are still fetched.',
  // The span between the preposition and the covers word was written as word characters, so a
  // character it could not read made the attachment pattern miss entirely, and a missed attachment
  // was read as no attachment, which pardons. Any punctuation inside the noun phrase did it. The
  // last three matter most: two of the six shipped surfaces are read as raw markdown, because
  // between() hands over what it finds rather than stripping it the way section() does, so emphasis,
  // code and links are exactly the characters that appear there.
  'Switch covers off and no cover is requested; the details for the (hidden) covers are still fetched.',
  'Switch covers off and no cover is requested; the details for the \u201chidden\u201d covers are still fetched.',
  'Switch covers off and no cover is requested; the details for the hidden-covers are still fetched.',
  'Switch covers off and no cover is requested; the details for **the covers** are still fetched.',
  'Switch covers off and no cover is requested; the details for `hidden` covers are still fetched.',
  'Switch covers off and no cover is requested; the details for [the covers](x) are still fetched.',
  // A sentence with no full stop, semicolon or comma inside it is one clause, so the clause the
  // acknowledgement is checked against was the whole sentence, and the switch phrase's own covers
  // word satisfied the check for it. Anything at all that looked like an acknowledgement anywhere
  // in the sentence then pardoned the lie in front of it. Coordinators end a clause now, for the
  // branches whose two halves are one assertion.
  'Switch covers off and no cover is requested and the details are still fetched.',
  'Switch covers off and no cover is requested and your notes are unchanged.',
  'Turning cover art off stops the covers being downloaded and your lists are unchanged.',
  'With cover art off no image is requested and the metadata is still fetched.',
  'Turn covers off and nothing is fetched from Marvel although the titles are still downloaded.',
  'Switch covers off and no cover is requested and the details requested for the covers are still fetched.',
  // Review re-joined those same lies with a conjunction outside the seven-word list and all forty
  // pardoned again, which is this file's standing failure: a rule resting on a hand-written list.
  // The list is twenty words now. These four are the shape that closed, one per new word tested;
  // reverting the list to its seven turns each of them green again, which is what makes the wider
  // list load-bearing rather than decorative.
  'Switch covers off and no cover is requested because the details are still fetched.',
  'Switch covers off and no cover is requested when your notes are unchanged.',
  'Switch covers off and no cover is requested if your notes are unchanged.',
  'Switch cover art off and the tiles are still there, no cover is requested after the details are still fetched.',
  // The mirror of that: the span between an acknowledgement's two halves excluded a full stop and
  // a semicolon but not a comma, while the clause reader split on all three. One match could
  // therefore begin in one clause and end in another, and the halves were read against clauses
  // neither of them was in. The first three put the acknowledging word in front of the lie, the
  // last three behind it.
  'Switch cover art off and the tiles are still there, no cover is requested.',
  'The titles are still there, and no cover is requested once you switch cover art off.',
  'Turn cover art off and the layout is still fast, no image is downloaded.',
  'Switch covers off and no cover is requested, and hidden covers continue to work.',
  'Turn cover art off and nothing is fetched, and the covers stay unchanged.',
  'Switch covers off and no cover is requested, so your covers stay unchanged.',
];
// The eighteen passages this instrument does not catch. The first two say a true thing and a false
// thing in one breath, and the true half is what excuses the false one. The first splits them across
// a full stop, which no rule about clauses inside a sentence can reach. The second hangs the true
// clause off the lie with no subject of its own, so it is read as an adverbial of the lie's subject,
// which is exactly what it looks like. A passage that contradicts itself needs a reader, and
// claiming otherwise would be the overclaim this whole item exists to undo.
//
// The next five are one shape: a covers word inside something that modifies a different head noun,
// reached with no preposition to hang it off. The third is the asserting-clause form, "the details
// the covers carry are still fetched"; the next four are the same shape standing as the antecedent
// a "they" is resolved against, in a reduced relative, a full relative and a participle in turn.
// Nothing in the punctuation or the word order separates any of them from "hides the covers but does
// not stop them": telling them apart needs to know that "hides" is a verb and "details" is a noun.
// That is parsing, and every list written in this file in place of parsing has been walked through
// within a round, so the shape is recorded rather than guessed at.
//
// The seven after those are the trailing-adverbial rule read back the other way. That rule hands a
// subjectless trailing fragment to the clause in front of it, which is right whenever that clause is
// the true half. When the fragment carries nothing at all the clause in front of it is the lie, and
// the lie names the covers and contains a request word, because "no cover is requested" is built out
// of exactly those. Six use a word in ADVERBIAL_ONLY and the seventh drops the comma so there is no
// trailing clause to classify, which is why removing those six words is not the repair: it closes
// the six and leaves the seventh, and it costs six true sentences, "the image is requested,
// regardless" among them, which is the collision recorded above for "unchanged" arriving in every
// other entry at once. Separating these from the true forms means reading the negation, and a rule
// that reads negation is the instrument this one replaced.
//
// The next two are the "covers" verb exclusion seen from the other side. That exclusion is described
// above as affordable because a word missing from it refuses a true sentence rather than excusing a
// false one, and in the asserting clause that is so. The same list also decides whether a passage is
// read as being about the covers switch at all, and there the direction inverts: a word present in
// it, "you" or "your", stops "hide the covers you have not read and Marvel is never asked for them"
// being examined, so it passes without ever being read. Giving window recognition its own reading of
// the noun catches both and was measured as refusing four true sentences, every one of them an
// ordinary use of the verb, so the limit is recorded instead.
//
// The last two arrived with the coordinator break, and they are what the two decisions beside it
// cost. Review built 40 sentences by re-joining closed lies with a conjunction outside the list;
// extending the list to the subordinators took 26 of them for nothing, and 14 remain. Six are the
// price of keeping "but" and "yet" out, which the shipped About-view sentence requires, and the
// first entry below stands for those. Eight are the price of letting a trailing adverbial keep the
// wider gap, which is the whole of what that branch is for, and the second stands for those. Both
// families are unbounded in the joining word, so a representative of each is recorded rather than
// an enumeration that would be stale the moment somebody writes a conjunction nobody thought of.
// That is also why the residual below is not a bound and is no longer described as one.
const RECORDED_ESCAPES = [
  'They can be hidden, and then they are not requested at all. Titles and dates are still fetched.',
  'Switch covers off and no cover is requested, or your notes sent, as before.',
  'Switch covers off and no cover is requested; the details the covers carry are still fetched.',
  'Switch covers off and no cover is requested. The details the covers carry are separate, and they are still fetched.',
  'Switch covers off and no cover is requested. The details some covers carry are separate, and they are still fetched.',
  'Switch covers off and no cover is requested. The metadata that describes covers is separate, and they are still fetched.',
  'Switch covers off and no cover is requested. The panel headed cover art is separate, and they are still fetched.',
  'Switch covers off and no cover is requested, regardless.',
  'Switch covers off and no cover is requested, anyway.',
  'Switch covers off and no cover is requested, as before.',
  'Switch covers off and no cover is requested, exactly as before.',
  'Switch covers off and no cover is requested, all the same.',
  'Switch covers off and no cover is requested, no different.',
  'Switch covers off and no cover is requested regardless.',
  'Hide the covers you have not read and Marvel is never asked for them.',
  'Hide the covers your lists name and nothing is requested.',
  'Switch covers off and no cover is requested but the details are still fetched.',
  'Switch covers off and no cover is requested because the page loads exactly as before.',
];

// True sentences this instrument refuses, with the repair beside each. They fall into eight classes,
// and the middle three are the interesting ones.
//
// Four say "the requests" without saying which requests, and two lean on "one" or "each" as a
// pronoun for the covers, which this instrument deliberately does not read as one because "each of
// your lists is unchanged" pardoned a lie with it. Five of those six are repaired by naming the
// covers, so they cost a word. The sixth costs a word and a reordering: naming the covers in "The
// requests are, in fact, unchanged" produces the sixth entry below, which is still refused because
// the parenthetical still stands between the subject and its verb, so its repair moves "in fact" to
// the front as well.
//
// The next five do name the covers, in the same sentence, but not in the clause that makes the
// assertion: a parenthetical or a coordinator sits between the subject and its verb, leaving clauses
// like "continue to be requested" and "is still requested" with no subject in them at all. Walking
// left to find the subject would accept all five, and it was measured against this corpus: it also
// pardons 57 of the 121 sentences below and accepts 21 of these 25 refusals, because a leftward walk
// lends a subject across clause boundaries in whichever direction happens to help. All five repair by
// moving the parenthetical, four to the end of the sentence and one to the front, which adds nothing
// and removes nothing, and is why the comment at the head of this file no longer claims every repair
// adds a word.
//
// The twelfth arrived with the pronoun tie, and is the cost of it. "Hiding them changes nothing
// about what is requested" refers to the covers with "them", which is never a subject in English, so
// the tie will not read it as one: the clause asserts about the hiding, and what is hidden sits in
// the object. Admitting "them" after a hiding or a stopping verb would recover the sentence, and was
// measured as recovering nothing else, but it would do so by enumerating verbs, which is the shape
// of instrument that tie replaced. Naming the covers repairs it, so it costs a word like the first
// five. It is recorded rather than argued away because it is close to the copy the metadata card
// actually ships.
//
// The next two are the cost of reading the whole preposition class, and they are the same cost in
// two shapes. "Even with cover art off there is no reduction in requests" hangs its only covers word
// off "Even", so the clause reads as one about something else. "Even without cover art the app still
// requests every cover" has two covers words and neither survives, because the span between a
// preposition and the noun it governs runs to the end of the clause: "Even" is read as the
// attachment of every covers word after it, not only of the one beside it. That reach is what makes
// the rule safe against punctuation it cannot parse, and this is its price. Ignoring a preposition
// that opens its clause would recover both, and was measured as pardoning four sentences above whose
// head noun carries no determiner, "details for the covers are still fetched" among them. Two true
// sentences that repair by deleting or naming a word are the cheaper of the two, and refusing is the
// loud direction.
//
// The next four are the price of separating a passive from a post-modifier. A participle counts as
// something that requests only when a form of "be" or a request noun stands in front of it, which
// takes "a request is still sent for each cover" and leaves "the details requested for the covers"
// closed. What it also leaves closed is the true version of that same shape: "the bytes fetched for
// the covers are unchanged" hangs the covers off a participle modifying a noun that is not a
// request, which is the evasion's shape exactly. Reading the difference means knowing that bytes
// are not requests and details are not covers, which is knowledge about the world rather than about
// the sentence. All four repair by naming a request where the refused form named its object.
//
// The next two are the price of ending a clause at a coordinator. The branches that assert
// something about a request assert it of one coordinate clause, so "the image is requested and the
// traffic to Marvel is unchanged" is read as two claims and checked against the second, which does
// not name the covers. Both were accepted before that change, and writing a comma in front of the
// coordinator was refused before it and is refused now, so the change made the rule consistent
// rather than stricter. They repair by putting the assertion in the clause that carries the covers,
// one by reordering and one by using an adverbial, which is the form that is allowed to lean on the
// clause before it.
//
// The last five are the price of widening that same list from seven words to twenty. Every one is
// predicate coordination over a shared subject: "the covers are hidden and still requested" states
// two things about one subject, and cutting at the coordinator leaves the second with no subject in
// it. Not cutting when the following segment has no subject of its own would accept all five, and it
// is the obvious repair, which is why it is written down here as rejected rather than left unsaid:
// every candidate test for "has a subject of its own" is another list of words written by hand, and
// this file has had four such lists walked through, each within the round that added it. The five
// repair by naming the covers again in the second clause or by writing a semicolon in place of the
// coordinator, which is what the sentence means. One of them is the shipped About-view sentence with
// "and" written for its "but", so its repair is the shipped wording, and that pair is the clearest
// statement of what this class costs: the rule is indifferent to which conjunction joins two
// predicates, and the copy is not.
//
// Each repaired form is in ACCEPTED_SENTENCES, so this list cannot be satisfied by wording nobody
// would write. Two refusals share a repair, and one of the five added with the wider coordinator
// list repairs to a sentence already recorded as the shipped copy, so the twenty-five have
// twenty-four distinct repaired forms.
const RECORDED_REFUSALS = [
  ['Switch covers off and nothing on screen is a picture; the requests are unchanged.',
    'Switch covers off and nothing on screen is a picture; the requests for the covers are unchanged.'],
  ['Switch covers off and every cover becomes a tile, but the same requests are made.',
    'Switch covers off and every cover becomes a tile, but the same requests for covers are made.'],
  ['Switch covers off and every cover becomes a tile, but the same number of requests goes out.',
    'Switch covers off and every cover becomes a tile, but the same number of requests for covers goes out.'],
  ['Switch covers off and every cover becomes a tile. The requests are, in fact, unchanged.',
    'Switch covers off and every cover becomes a tile. In fact, the requests for covers are unchanged.'],
  ['Switch covers off and no cover is shown, though each one is requested exactly as before.',
    'Switch covers off and no cover is shown, though each cover is requested exactly as before.'],
  ['Switch covers off and every cover becomes a tile. The requests for covers are, in fact, unchanged.',
    'Switch covers off and every cover becomes a tile. In fact, the requests for covers are unchanged.'],
  ['switching cover art off hides the covers, and every one is requested regardless.',
    'switching cover art off hides the covers, and every cover is requested regardless.'],
  ['The covers, even when hidden, continue to be requested.',
    'The covers continue to be requested, even when hidden.'],
  ['Covers, whether shown or hidden, are requested regardless.',
    'Covers are requested regardless, whether shown or hidden.'],
  ['Cover art, once you switch it off, is still requested.',
    'Cover art is still requested once you switch it off.'],
  ['The image behind each tile, hidden or not, is requested exactly as before.',
    'The image behind each tile is requested exactly as before, hidden or not.'],
  ['Cover images load directly from Marvel\u2019s own servers. They can be hidden, and hiding them changes nothing about what is requested.',
    'Cover images load directly from Marvel\u2019s own servers. They can be hidden, and hiding the covers changes nothing about what is requested.'],
  ['Even with cover art off there is no reduction in requests.',
    'Even with cover art off there is no reduction in requests for the covers.'],
  ['Even without cover art the app still requests every cover.',
    'Without cover art the app still requests every cover.'],
  ['Turn cover art off, and the bytes fetched for the covers are unchanged.',
    'Turn cover art off, and the requests for the covers are unchanged.'],
  ['Switch covers off, and the address requested for every cover is unchanged.',
    'Switch covers off, and the request for every cover is unchanged.'],
  ['Hide the covers, and the data downloaded for each cover is unchanged.',
    'Hide the covers, and the download for each cover is unchanged.'],
  ['With covers hidden, the questions asked about the covers are still sent.',
    'With covers hidden, the requests for the covers are still sent.'],
  ['Switch covers off and every cover becomes a tile, but the image is requested and the traffic to Marvel is unchanged.',
    'Switch covers off and every cover becomes a tile, but the traffic to Marvel is unchanged and the image is requested.'],
  ['Switch covers off and every cover becomes a tile. The image is requested and unchanged.',
    'Switch covers off and every cover becomes a tile. The image is requested, exactly as before.'],
  ['Cover art is requested from Marvel\u2019s image servers as it appears; switching cover art off hides the covers and does not stop them being requested.',
    'switching cover art off hides the covers but does not stop them being requested'],
  ['Switch covers off and the tiles stay. The covers are hidden and still requested.',
    'Switch covers off and the tiles stay. The covers are hidden, and every cover is still requested.'],
  ['Switch covers off and the tiles stay. Cover art is hidden and still requested.',
    'Switch covers off and the tiles stay. Cover art is hidden, and each cover is still requested.'],
  ['Turn cover art off and the images are hidden and still requested.',
    'Turn cover art off and the images are hidden; every cover is still requested.'],
  ['Switch covers off and every cover is hidden although it is still requested.',
    'Switch covers off and every cover is hidden, though each cover is still requested.'],
];

test('every sentence the instrument must accept is accepted', () => {
  for (const sentence of ACCEPTED_SENTENCES) {
    assert.equal(unacknowledged(sentence), null, `refused a true sentence: ${sentence}`);
  }
});

test('every sentence the instrument must catch is caught', () => {
  for (const sentence of CAUGHT_SENTENCES) {
    assert.notEqual(unacknowledged(sentence), null, `pardoned a false sentence: ${sentence}`);
  }
});

test('each of the eighteen recorded escapes is still open', () => {
  for (const sentence of RECORDED_ESCAPES) {
    assert.equal(
      unacknowledged(sentence),
      null,
      `this escape is now caught, which is good: move it into CAUGHT_SENTENCES and say so in the item, rather than deleting it from here: ${sentence}`,
    );
  }
});

test('the true sentences this instrument refuses are still refused, and each repair works', () => {
  for (const [refused, repaired] of RECORDED_REFUSALS) {
    assert.notEqual(
      unacknowledged(refused),
      null,
      `this refusal is now accepted, which is good: move it into ACCEPTED_SENTENCES and say so in the item: ${refused}`,
    );
    assert.equal(unacknowledged(repaired), null, `the recorded repair does not work: ${repaired}`);
    assert.ok(
      ACCEPTED_SENTENCES.includes(repaired),
      `the repair must also be held as a true sentence: ${repaired}`,
    );
  }
});

// The comments above the corpus state three counts, and a count in prose is a claim nothing
// checks, which is the defect the whole corpus was landed to end. So all three are asserted here.
// The third was added in round fifteen, after review found it was the one count of the three left
// unasserted and the only one that had gone stale: it read nineteen while the tree held
// twenty-four. Both failures are instructions rather than verdicts: a sentence that stops being
// read as a covers window may well belong in the list, but the comment then has to say so.
test('the structural counts claimed above the corpus are the counts it has', () => {
  const notAboutSwitch = ACCEPTED_SENTENCES.filter((sentence) => {
    const parts = sentence.split(/(?<=[.!?])\s+/);
    for (let i = 0; i < parts.length; i += 1) {
      for (const j of [i, i + 1]) {
        if (j < parts.length && aboutTheSwitch(parts.slice(i, j + 1).join(' '))) return false;
      }
    }
    return true;
  });
  assert.equal(
    notAboutSwitch.length,
    8,
    `the comment above ACCEPTED_SENTENCES says eight of them are not about the covers switch, and ${notAboutSwitch.length} are: ${notAboutSwitch.join(' | ')}`,
  );

  const repairs = new Set(RECORDED_REFUSALS.map(([, repaired]) => repaired));
  assert.equal(
    repairs.size,
    24,
    `the comment above RECORDED_REFUSALS says twenty-four of them are distinct repaired forms, and there are ${repairs.size}`,
  );

  // Counted over the entries rather than the set, which is what makes this fail on its own rather
  // than restating the assertion above it: every repair being held as a true sentence is already
  // asserted per refusal, so the only way these two counts can disagree is a repaired form written
  // into ACCEPTED_SENTENCES twice, and nothing else in the file forbids that.
  const heldAsTrue = ACCEPTED_SENTENCES.filter((sentence) => repairs.has(sentence));
  assert.equal(
    heldAsTrue.length,
    24,
    `the comment above ACCEPTED_SENTENCES says twenty-four of them are repaired forms of refusals, and ${heldAsTrue.length} are`,
  );
});
