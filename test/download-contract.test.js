import test from 'node:test';
import assert from 'node:assert/strict';
import { browserDownload, saveDownload, setDownloadHandler } from '../src/js/lib/download.js';

test('browser requests are distinct from completed native downloads and unknown adapter outcomes', async () => {
  const previous = globalThis.document;
  const actions = [];
  globalThis.document = {
    createElement: () => ({ click: () => actions.push('click'), remove: () => actions.push('remove') }),
    body: { append: () => actions.push('append') },
  };
  try {
    setDownloadHandler(browserDownload);
    assert.equal(await saveDownload('copy.json', 'precious', 'application/json'), 'requested');
    assert.deepEqual(actions, ['append', 'click', 'remove']);
    const { downloadMessage } = await import('../src/js/lib/download.js');
    assert.match(downloadMessage('requested', 'Backup'), /requested.*confirm it was saved/);
    assert.equal(downloadMessage(true, 'Backup'), 'Backup downloaded.');
    for (const result of [true, false, 'requested', 'saved', {}, 1, null, undefined]) {
      setDownloadHandler(() => result);
      assert.equal(await saveDownload('copy.json', 'precious', 'application/json'),
        result === true || result === 'requested' ? result : false);
    }
  } finally {
    setDownloadHandler(browserDownload);
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});
