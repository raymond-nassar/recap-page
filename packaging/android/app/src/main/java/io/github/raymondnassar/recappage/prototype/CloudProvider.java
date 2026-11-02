package io.github.raymondnassar.recappage.prototype;

import java.util.List;

// What differs between the cloud services, as the adapters in host/cloudHost.mjs divide it on Windows. Only the
// drive half is here so far: Google Drive's on Android (CloudGoogleDrive) is built and tested but nothing makes
// one until Android has a way to sign in to Google (#810, P04), so the account still knows OneDrive alone.
interface CloudProvider {
    // The four operations the shared protocol asks of a service, on the folder the account recorded.
    interface Drive {
        List<CloudOneDrive.Item> list() throws CloudError;

        byte[] read(String id) throws CloudError;

        CloudOneDrive.Item create(String name, byte[] bytes) throws CloudError;

        void delete(String id) throws CloudError;
    }
}