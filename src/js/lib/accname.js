// Builds a control's accessible name out of its visible label.
//
// WCAG SC 2.5.3 Label in Name requires the accessible name to contain the words shown on the
// control, so a speech-input user can activate it by saying what they can see. Measured in Edge
// at 1280x900 on 2026-08-12 with one order imported and the reading rows open, 124 of the 303
// rendered controls that carry both a visible label and an aria-label failed, because every name
// was written beside its label instead of out of it. "+ Add to library" answered to "Add House
// of M to library", which does not contain "add to library" once the order's name is spliced
// into the middle of it. The measurement is recorded at docs/ux-artifacts/label-in-name.json.
//
// The point of routing them through here is that the caller no longer supplies a name. It
// supplies the label it is about to show and the context to add, so a name that omits the label
// is not something a call site can express. That is why this is a function rather than a rule
// applied at each site: a rule is a list someone has to keep complete, and the nine sites this
// was found at had been written one at a time by someone applying exactly that rule.

// Symbolic characters are not part of a visible label. The Understanding document's example is
// ">" standing in for a play arrow, and the labels here carry "+", "✓", "→" and "↗" for exactly
// that decorative purpose. Punctuation and capitalisation are ignored by speech recognition, so
// dropping them cannot lose a word anybody would say, and a label that is nothing but symbols
// correctly reduces to no label at all.
const NOT_WORD = /[^\p{L}\p{N}]+/gu;

export function labelWords(label) {
  return String(label ?? '').replace(NOT_WORD, ' ').trim();
}

// The colon keeps the label's words together and unbroken at the front of the name, which is
// what containment needs. Joining with a space instead would read as one run-on phrase, and
// splicing the context into the middle is the very thing that broke the nine sites above.
export function labelledName(label, context) {
  const words = labelWords(label);
  const extra = String(context ?? '').trim();
  if (!words) return extra;
  return extra ? `${words}: ${extra}` : words;
}

// A control whose visible text is several pieces, such as a category card's eyebrow, title and
// count, is named by those pieces in the order they are shown, then by whatever it adds. The axe
// rules pass found three controls naming the same pieces in another order, or with words spliced
// between them, which a speech-input user cannot say as one phrase (#905). Unlike labelledName this
// keeps punctuation, because these pieces are text a reader sees rather than symbols beside a
// label: "3 / 20" is read as a count, where its words alone would be read "3 20". Each piece ends
// as a sentence, so a screen reader pauses between pieces that are visibly separate.
export function shownName(parts, context) {
  return [...parts, context]
    .map((part) => String(part ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
    .join(' ');
}
