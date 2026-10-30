import { readerDestination } from './readerDestination.js';

export const NOTICE_DISMISSAL_KEY = 'mrt.readerClosure.dismissed.v1';

// The notice says something materially different once reading in Marvel Unlimited has ended, so
// each phase is its own identity: dismissing the warning before December 7 must not hide the
// later explanation of why Read now opens the Marvel Comics website.
export function readerClosureNoticeId(now = new Date()) {
  return `marvel-unlimited-closure-${readerDestination(now)}`;
}

// An acknowledgement belongs to this device, like Home updates seen state, not to portable
// settings. The identity is read on every check, so a page left open across the cutoff shows the
// new notice without a reload.
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
