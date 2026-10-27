package io.github.raymondnassar.recappage.prototype;

import android.content.Context;
import java.io.IOException;

final class CloudAndroidProtection implements CloudSessions.Factory {
    private final Context context;
    CloudAndroidProtection(Context context) { this.context = context.getApplicationContext(); }
    @Override public CloudSessions.Protected open(CloudOwnership.Binding binding, String reference) throws IOException {
        CloudCredentialStore store = new CloudCredentialStore(context, reference, CloudOwnership.provider(binding.provider), binding.clientId, true);
        return new CloudSessions.Protected() {
            @Override public String load() throws IOException { return store.load(); }
            @Override public void save(String value) throws IOException { store.save(value); }
            @Override public void clear() throws IOException { store.clear(); }
            @Override public boolean present() throws IOException { return store.present(); }
        };
    }
}
