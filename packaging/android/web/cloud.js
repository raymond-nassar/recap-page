// Installs the Android app's cloud backup transport before the page module reads it, so app.js imports
// this first (#810, P03-T03). The bridge hands the port to cloudPort once the app connects.

import { createCloudHostTransport } from '../js/lib/cloudHostTransport.js';
import { installCloudTransport } from '../js/lib/cloudTransports.js';
import { createAndroidCloudTransport, createCloudPort } from './cloudPort.js';

export const cloudPort = createCloudPort();
installCloudTransport(createAndroidCloudTransport(cloudPort, createCloudHostTransport));
