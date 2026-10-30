// The one cloud backup transport the page is given (#810). The Windows host's control API on this origin
// is the default; an app that carries its own bridge installs it here before the page module is
// evaluated, as the Android app does from packaging/android/web/cloud.js (P03-T03). Installing twice is a
// mistake in the app's wiring rather than something to settle by order, so it throws.

import { createCloudHostTransport } from './cloudHostTransport.js';

let installed = null;

export function installCloudTransport(transport) {
  if (installed) throw new Error('A cloud backup transport is already installed.');
  installed = transport;
}

export function cloudTransport() {
  return installed ?? createCloudHostTransport();
}
