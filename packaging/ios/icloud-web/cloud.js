// Installs the iOS app's iCloud backup transport before the page module reads it (#949, P04). This folder
// sits outside packaging/ios/web, which the iOS build copies whole: prepare-ios copies it in, and has
// app.js import this first, only when packaging/ios/features.json switches iCloud backup on.

import { createCloudHostTransport } from '../js/lib/cloudHostTransport.js';
import { installCloudTransport } from '../js/lib/cloudTransports.js';
import { createICloudTransport } from './icloudTransport.js';

installCloudTransport(createICloudTransport({
  native: globalThis.window?.webkit?.messageHandlers?.recap,
  createTransport: createCloudHostTransport,
}));
