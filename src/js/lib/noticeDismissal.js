export const NOTICE_DISMISSAL_KEY = 'mrt.readerClosure.dismissed.v1';

// Each notice text owns its identity, so dismissing an earlier text never hides a later one. #1601
// replaced both Marvel Unlimited phase texts with one approved text that no longer depends on the
// date, and gave it an identity neither phase ever stored: the earlier post-cutoff identity named
// different words, so reusing it would hide the new text from anyone who had dismissed those.
const APP_VIEWER_NOTICE_ID = 'marvel-comics-app-viewer';

// The date parameter is kept so callers written for the phased notice still resolve one identity.
// eslint-disable-next-line no-unused-vars
export function readerClosureNoticeId(now = new Date()) {
  return APP_VIEWER_NOTICE_ID;
}

// An acknowledgement belongs to this device, like Home updates seen state, not to portable
// settings.
export function createNoticeDismissal({ storage, notice = () => readerClosureNoticeId() } = {}) {
  const current = typeof notice === 'function' ? notice : () => notice;
  let dismissedThisPage = null;

  function stored() {
    try {
      return storage?.getItem(NOTICE_DISMISSAL_KEY) ?? null;
    } catch {
      // An unreadable acknowledgement cannot hide information.
      return null;
    }
  }

  function dismissed() {
    const id = current();
    return dismissedThisPage === id || stored() === id;
  }

  function dismiss() {
    const id = current();
    dismissedThisPage = id;
    try {
      if (!storage) throw new Error('Browser storage is unavailable.');
      storage.setItem(NOTICE_DISMISSAL_KEY, id);
      if (storage.getItem(NOTICE_DISMISSAL_KEY) !== id) {
        return { remembered: false, reason: 'write-unverified', error: null };
      }
      return { remembered: true, reason: 'remembered', error: null };
    } catch (error) {
      return { remembered: false, reason: 'storage-failed', error };
    }
  }

  return { dismissed, dismiss };
}
