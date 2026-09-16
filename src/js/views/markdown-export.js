import { serializeChecklist } from '../lib/markdown.js';

export function chooseMarkdownExport(list) {
  const opener = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.id = 'markdown-export';
  dialog.className = 'ask markdown-export';
  dialog.setAttribute('aria-labelledby', 'markdown-export-title');
  dialog.setAttribute('aria-describedby', 'markdown-export-description');
  dialog.innerHTML = `
    <form method="dialog">
      <h2 id="markdown-export-title">Export as Markdown</h2>
      <p id="markdown-export-description" class="rail-hint">A readable copy of this list for other apps.
        Your saved list stays unchanged. Use a JSON backup to restore your data.</p>
      <fieldset>
        <legend>Include in the file</legend>
        <label class="checkbox"><input type="checkbox" name="includeProgress" checked> Read checkboxes</label>
        <label class="checkbox"><input type="checkbox" name="includeDescription"> List description</label>
        <label class="checkbox"><input type="checkbox" name="includeSections"> Collected-edition headings</label>
        <label class="checkbox"><input type="checkbox" name="includeLinks"> Official comic links</label>
        <label class="checkbox"><input type="checkbox" name="includeNotes"> My list and issue notes</label>
      </fieldset>
      <p class="rail-hint">Personal notes are left out unless you select them.</p>
      <p><label for="markdown-export-preview">File preview</label>
        <textarea id="markdown-export-preview" rows="8" readonly spellcheck="false"></textarea></p>
      <div class="ask-foot">
        <button type="button" class="btn btn-g" data-action="cancel">Cancel</button>
        <button type="submit" class="btn" value="download">Download Markdown</button>
      </div>
    </form>`;
  const form = dialog.querySelector('form');
  const preview = dialog.querySelector('textarea');
  const update = () => {
    const options = Object.fromEntries(
      [...form.querySelectorAll('input')].map((input) => [input.name, input.checked]),
    );
    preview.value = serializeChecklist(list, { ...options, literal: true });
  };
  update();
  form.addEventListener('change', update);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    update();
    dialog.close('download');
  });
  dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close(''));
  document.body.append(dialog);
  return new Promise((resolve, reject) => {
    dialog.addEventListener('close', () => {
      const result = dialog.returnValue === 'download' ? preview.value : null;
      dialog.remove();
      if (opener?.isConnected && !opener.disabled && !opener.inert && opener.getClientRects().length) {
        opener.focus();
      }
      resolve(result);
    }, { once: true });
    try {
      dialog.showModal();
    } catch (error) {
      dialog.remove();
      reject(error);
    }
  });
}
