export const SAVE_EDUCATION_KEY = 'mrt.saveEducation.v1';

export const SAVE_EDUCATION_STATE = Object.freeze({
  UNSEEN: 'unseen',
  EXPLAINING: 'explaining',
  COMPLETE: 'complete',
});

const RANK = {
  [SAVE_EDUCATION_STATE.UNSEEN]: 0,
  [SAVE_EDUCATION_STATE.EXPLAINING]: 1,
  [SAVE_EDUCATION_STATE.COMPLETE]: 2,
};

function parse(raw) {
  return raw === SAVE_EDUCATION_STATE.EXPLAINING || raw === SAVE_EDUCATION_STATE.COMPLETE
    ? raw
    : SAVE_EDUCATION_STATE.UNSEEN;
}

function higher(left, right) {
  return RANK[left] >= RANK[right] ? left : right;
}

export function createSaveEducation({ storage } = {}) {
  let memory = read().state;

  function read() {
    if (!storage) return { state: SAVE_EDUCATION_STATE.UNSEEN, readable: false };
    try {
      return { state: parse(storage.getItem(SAVE_EDUCATION_KEY)), readable: true };
    } catch {
      return { state: SAVE_EDUCATION_STATE.UNSEEN, readable: false };
    }
  }

  function reconcile() {
    const durable = read();
    memory = higher(memory, durable.state);
    if (!durable.readable || RANK[durable.state] >= RANK[memory]) return;
    try {
      storage.setItem(SAVE_EDUCATION_KEY, memory);
      memory = higher(memory, read().state);
    } catch {
      // This preference cannot be allowed to turn a saved reader-data action into a failure.
    }
  }

  function current() {
    reconcile();
    return memory;
  }

  function advance(requested) {
    const previous = current();
    const next = higher(previous, requested);
    memory = next;
    reconcile();
    return { previous, current: memory, changed: previous !== memory };
  }

  function adopt(raw) {
    const previous = memory;
    memory = higher(memory, parse(raw));
    reconcile();
    return { previous, current: memory, changed: previous !== memory };
  }

  return {
    current,
    begin: () => advance(SAVE_EDUCATION_STATE.EXPLAINING),
    complete: () => advance(SAVE_EDUCATION_STATE.COMPLETE),
    adopt,
  };
}
