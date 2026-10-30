export const NOTICE_DISMISSAL_KEY = 'mrt.readerClosure.dismissed.v1';
export const READER_CLOSURE_NOTICE = 'marvel-unlimited-closure-v1';

// An acknowledgement belongs to this device, like Home updates seen state, not to
// portable settings. A new notice identity must be acknowledged independently.
export function createNoticeDismissal({ storage, notice = READER_CLOSURE_NOTICE } = {}) {
  let dismissed = false;
  try {
    dismissed = storage?.getItem(NOTICE_DISMISSAL_KEY) === notice;
  } catch {
    // An unreadable acknowledgement cannot hide information.
  }

  function dismiss() {
    dismissed = true;
    try {
      if (!storage) throw new Error('Browser storage is unavailable.');
      storage.setItem(NOTICE_DISMISSAL_KEY, notice);
      if (storage.getItem(NOTICE_DISMISSAL_KEY) !== notice) {
        return { remembered: false, reason: 'write-unverified', error: null };
      }
      return { remembered: true, reason: 'remembered', error: null };
    } catch (error) {
      return { remembered: false, reason: 'storage-failed', error };
    }
  }

  return { dismissed: () => dismissed, dismiss };
}
