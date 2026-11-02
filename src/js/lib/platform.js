export function isIosApp() {
  return globalThis.document?.documentElement?.dataset?.platform === 'ios';
}
