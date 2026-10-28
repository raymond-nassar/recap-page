// The page's entry point, and deliberately the only thing that runs the application.
//
// `src/js/main.js` used to be loaded directly, which meant importing it was the same act as
// starting it. That made the module untestable in Node twice over: it read the document while
// being evaluated, so the import threw before any test body could install a double, and it
// exported nothing, so an import that did succeed handed back an empty object with no render
// path to call. Splitting the entry from the module fixes both without a DOM implementation
// and without waiting for the file to be split by view.
//
// This file is intentionally tiny. Anything added here is code no test can reach, because this
// is the one module that a test cannot import without starting the app.
import { boot, notify } from './main.js';
import { registerOffline } from './lib/offline.js';
import { wireInstallation } from './lib/install.js';

wireInstallation({ notify });
boot();

// After boot, and the order is the whole of the reasoning. Registering the offline worker is a
// promise about the next launch rather than about this one, so nothing on screen waits for it,
// and putting it second means a browser that refuses workers has already drawn the app before
// the refusal is known. The same bargain this file already makes for boot(): the decision it
// calls into is tested in src/js/lib/offline.js, and the one untestable line is the call.
registerOffline().then((result) => {
  if (!result.ok) console.info(`Offline launch is not available: ${result.reason}`);
});
