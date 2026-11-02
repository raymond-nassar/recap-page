package io.github.raymondnassar.recappage.prototype;

import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

final class CloudGoogleConsent {
    private final Map<String, CloudAccount.Consent> pending = new HashMap<>();

    interface Action<E extends Exception> {
        void run() throws E;
    }

    synchronized String add(CloudAccount.Consent consent) {
        Objects.requireNonNull(consent);
        String id;
        do {
            id = UUID.randomUUID().toString();
        } while (pending.putIfAbsent(id, consent) != null);
        return id;
    }

    synchronized boolean has(String id) {
        return id != null && pending.containsKey(id);
    }

    synchronized CloudAccount.Consent take(String id) {
        return id == null ? null : pending.remove(id);
    }

    synchronized void cancel(String id) {
        if (id != null) pending.remove(id);
    }

    // A cancelled attempt must not start a screen after the check that found it pending.
    synchronized <E extends Exception> boolean runIfPending(String id, Action<E> action) throws E {
        if (id == null || !pending.containsKey(id)) return false;
        action.run();
        return true;
    }
}
