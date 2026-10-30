// In-page naming and confirmation, replacing prompt() and confirm().
//
// The browser's own dialogs were the wrong tool three times over: they cannot be styled or
// announced through the app's own live region, they block the whole page, and a browser that
// has been told to suppress them returns false from confirm() without asking, so a destructive
// action would quietly fail rather than be confirmed.
//
// One <dialog> serves every question. Measured in Edge, Escape and Cancel moved focus to the
// view heading rather than the control that opened it, making a reader lose their place.
// The curated-order preview uses the same dialog pattern.

const OK = 'ok';

let pending = null;
let opener = null;
let naming = false;
// The answers of the question being asked with a choice, or null: the plain one, and the one its
// checked choice turns it into.
let choosing = null;

function parts() {
  return {
    dlg: document.getElementById('ask'),
    form: document.getElementById('ask-form'),
    title: document.getElementById('ask-title'),
    body: document.getElementById('ask-body'),
    field: document.getElementById('ask-field'),
    label: document.getElementById('ask-label'),
    input: document.getElementById('ask-input'),
    error: document.getElementById('ask-error'),
    areaField: document.getElementById('ask-area-field'),
    areaLabel: document.getElementById('ask-area-label'),
    area: document.getElementById('ask-area'),
    choiceField: document.getElementById('ask-choice-field'),
    choiceLabel: document.getElementById('ask-choice-label'),
    choice: document.getElementById('ask-choice'),
    ok: document.getElementById('ask-ok'),
    cancel: document.getElementById('ask-cancel'),
  };
}

// The answer button says what a checked choice will do, and only then wears the danger appearance.
function showChoice() {
  const { ok, choice } = parts();
  if (!choosing || !ok || !choice) return;
  ok.textContent = choice.checked ? choosing.chosenLabel : choosing.confirmLabel;
  ok.classList.toggle('btn-danger', choice.checked);
}

// Called once at start-up. The close listener lives here rather than being added per question,
// so a question that is answered twice, by submitting as Escape is pressed, cannot resolve twice.
export function wireAsk() {
  const { dlg, form, cancel, input, area, error, choice } = parts();
  if (!dlg) return;
  const clearError = () => {
    input.removeAttribute('aria-invalid');
    error.textContent = '';
  };
  input.addEventListener('input', clearError);
  choice?.addEventListener('change', showChoice);
  form.addEventListener('submit', (event) => {
    if (!naming || input.value.trim()) return;
    event.preventDefault();
    error.textContent = 'Enter a name, not just spaces.';
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  });
  cancel.addEventListener('click', () => dlg.close(''));
  dlg.addEventListener('close', () => {
    const settle = pending;
    pending = null;
    // The typed value is read here, while the dialog is closing, rather than by the caller
    // after it has awaited: the field is shared, so the next question would otherwise be able
    // to overwrite an answer that had not been read yet.
    if (settle) {
      settle({
        ok: dlg.returnValue === OK, value: input.value, area: area ? area.value : '',
        choice: Boolean(choosing && choice?.checked),
      });
    }
    choosing = null;
    const restore = opener;
    opener = null;
    if (restore && restore.isConnected && !restore.disabled && !restore.hidden && !restore.inert
      && typeof restore.focus === 'function') restore.focus();
  });
}

// Resolves when the reader answers. Escape and Cancel both count as backing out, which is what
// makes the destructive default "no".
function open({
  title, body, confirmLabel, prefill = null, inputLabel = '', multiline = false, danger = false, choice = null,
}) {
  const {
    dlg, title: h, body: p, field, label, input, error, areaField, areaLabel, area, choiceField, choiceLabel,
    choice: box, ok, cancel,
  } = parts();
  if (!dlg || pending) return Promise.resolve({ ok: false, value: '', area: '', choice: false });
  // A page whose dialog has no choice cannot ask a question that needs one.
  if (choice && !(choiceField && box && choiceLabel)) return Promise.resolve({ ok: false, value: '', area: '', choice: false });

  h.textContent = title;
  p.textContent = body;
  p.hidden = !body;
  ok.textContent = confirmLabel;
  // UX-31 (#830): an answer that cannot be taken back wears the danger appearance Erase all local data
  // already has, so it does not look like every other confirmation. Set on every question, so the next
  // one cannot inherit it. Cancel still comes first and takes focus.
  ok.classList.toggle('btn-danger', danger);

  const asksForText = prefill !== null && !multiline;
  const asksForNote = prefill !== null && multiline;
  // #849: a confirmation keeps its answers in view, so it can open at its start (see styles.css).
  dlg.setAttribute('data-question', asksForText ? 'text' : asksForNote ? 'note' : 'confirm');
  naming = asksForText;
  input.removeAttribute('aria-invalid');
  error.textContent = '';
  field.hidden = !asksForText;
  input.required = asksForText;
  label.textContent = asksForText ? inputLabel : '';
  input.value = asksForText ? prefill : '';

  // Never required. An emptied note is the reader deleting it, which is a real answer and has to
  // be submittable; `required` would refuse the submit and leave them with no way to clear it.
  if (areaField) {
    areaField.hidden = !asksForNote;
    areaLabel.textContent = asksForNote ? inputLabel : '';
    area.value = asksForNote ? prefill : '';
  }

  // Unchecked every time it is asked, so going further than the plain answer is always a choice made
  // in this question, never one left over from the last.
  choosing = choice ? { confirmLabel, chosenLabel: choice.confirmLabel } : null;
  if (choiceField) {
    choiceField.hidden = !choice;
    choiceLabel.textContent = choice ? choice.label : '';
    box.checked = false;
  }

  // Cleared rather than trusted to be. Escape closes the dialog without touching returnValue
  // in browsers that predate the change making it "", so a question answered with Escape
  // would otherwise inherit the "ok" left behind by the last one that was confirmed. That
  // turns a cancelled deletion into a deletion.
  dlg.returnValue = '';

  const answered = new Promise((resolve) => { pending = resolve; });
  const nextOpener = document.activeElement;
  try {
    dlg.showModal();
  } catch {
    // An already-open dialog throws. Leaving `pending` set would wedge every later question,
    // because open() refuses to run while one is outstanding.
    pending = null;
    choosing = null;
    return Promise.resolve({ ok: false, value: '', area: '', choice: false });
  }
  opener = nextOpener;
  if (asksForText) input.select();
  if (asksForNote) area.select();
  // A dialog focuses its first control, which a choice would be, so Cancel is given focus outright.
  if (choice) cancel.focus();
  // #849: Cancel takes focus, as a destructive question needs, and focusing it scrolled a long question
  // past its own title: 454 to 802px down at 200% text on Android sizes.
  if (!asksForText && !asksForNote) dlg.scrollTop = 0;
  return answered;
}

// `danger` is for an answer with no way back: no Undo, no kept copy, nothing else to recover from.
export async function askConfirm({ title, body = '', confirmLabel = 'Confirm', danger = false }) {
  const { ok } = await open({ title, body, confirmLabel, danger });
  return ok;
}

// A confirmation with one unchecked choice that takes the answer further, as disconnecting cloud backup
// can also delete this device's backups (#810). The plain answer is one with a way back; checking the
// choice changes the answer's label to `choiceConfirmLabel` and gives it the danger appearance, because
// only that answer has none. Resolves { choice } when confirmed, or null when the reader backs out.
export async function askConfirmChoice({ title, body = '', confirmLabel, choiceLabel, choiceConfirmLabel }) {
  const { ok, choice } = await open({ title, body, confirmLabel, choice: { label: choiceLabel, confirmLabel: choiceConfirmLabel } });
  return ok ? { choice } : null;
}

// The submit listener keeps whitespace-only names editable; cancellation still resolves null.
export async function askText({ title, body = '', label, value = '', confirmLabel = 'Save' }) {
  const { ok, value: typed } = await open({ title, body, confirmLabel, prefill: value, inputLabel: label });
  return ok ? typed.trim() || null : null;
}

// Returns the typed note, or null if the reader backed out. Unlike askText, an emptied field
// resolves to "" rather than null, because clearing a note and cancelling are different answers
// and the caller has to be able to tell them apart. askText cannot: it folds both to null, which
// is correct for a name, since a list with no name is not a thing the reader can ask for.
export async function askNote({ title, body = '', label, value = '', confirmLabel = 'Save note' }) {
  const { ok, area } = await open({
    title, body, confirmLabel, prefill: value, inputLabel: label, multiline: true,
  });
  return ok ? area.trim() : null;
}
