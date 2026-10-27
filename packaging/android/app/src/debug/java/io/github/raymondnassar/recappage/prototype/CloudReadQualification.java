package io.github.raymondnassar.recappage.prototype;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import java.util.function.LongSupplier;

final class CloudReadQualification {
    private final String provider;
    private final String phase;
    private final String nonce;
    private final String accountHash;
    private final String fileId;
    private final String digest;
    private final String rootId;
    private final String driveId;
    private final LongSupplier now;
    private final long until;
    private final AtomicBoolean used = new AtomicBoolean();
    private volatile boolean closed;

    CloudReadQualification(String provider, String phase, String nonce, String accountHash,
            String fileId, String digest, String rootId, String driveId, LongSupplier now) {
        boolean microsoft = "microsoft".equals(provider);
        if (!(microsoft || "google".equals(provider)) || !("prepare".equals(phase) || "reopen".equals(phase))
                || !hex(nonce) || !hex(accountHash) || !hex(digest) || !identifier(fileId) || now == null
                || microsoft && (!identifier(rootId) || driveId != null && !identifier(driveId))
                || !microsoft && (rootId != null || driveId != null)) {
            throw new IllegalArgumentException("The exact synthetic read qualification is invalid.");
        }
        this.provider = provider;
        this.phase = phase;
        this.nonce = nonce;
        this.accountHash = accountHash;
        this.fileId = fileId;
        this.digest = digest;
        this.rootId = rootId;
        this.driveId = driveId;
        this.now = now;
        this.until = Math.addExact(now.getAsLong(), 6 * 60 * 1000);
    }

    private static boolean hex(String value) { return value != null && value.matches("[a-f0-9]{64}"); }
    private static boolean identifier(String value) {
        return value != null && value.matches("[A-Za-z0-9!_.:-]{1,256}") && !".".equals(value) && !"..".equals(value);
    }

    boolean current(String provider, String phase, String nonce) {
        return active() && matches(provider, phase, nonce);
    }

    boolean active() { return !closed && now.getAsLong() < until; }
    boolean matches(String provider, String phase, String nonce) {
        return this.provider.equals(provider) && this.phase.equals(phase) && this.nonce.equals(nonce);
    }

    void claim(String provider, String phase, String nonce, String accountHash) {
        if (!current(provider, phase, nonce) || !this.accountHash.equals(accountHash)
                || !used.compareAndSet(false, true)) {
            throw new IllegalStateException("The synthetic read qualification is inactive, mismatched or already used.");
        }
    }

    CloudProviderReads.Selected read(String provider, String phase, String nonce, String accountHash,
            String token, BooleanSupplier active) throws Exception {
        claim(provider, phase, nonce, accountHash);
        BooleanSupplier current = () -> active.getAsBoolean() && current(provider, phase, nonce);
        if (!current.getAsBoolean()) throw new IllegalStateException("The synthetic read owner is inactive.");
        CloudProviderHttp.Provider selected = "microsoft".equals(provider)
                ? CloudProviderHttp.Provider.MICROSOFT : CloudProviderHttp.Provider.GOOGLE;
        CloudProviderHttp http = new CloudProviderHttp(selected, () -> token, current);
        CloudProviderReads reads = new CloudProviderReads(http, rootId, driveId);
        CloudProviderReads.Selected result = reads.readFile(fileId, 1024);
        if (!current.getAsBoolean() || !digest.equals(result.digest)) {
            throw new IllegalStateException("The exact synthetic file digest was not verified.");
        }
        return result;
    }

    void close() { closed = true; }
}
