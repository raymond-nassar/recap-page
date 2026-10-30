package io.github.raymondnassar.recappage.prototype;

// One kind of failure for everything the account and OneDrive can do, carrying the code the page and its
// coordinator act on. The codes are the transport contract's, under Cloud backup in docs/ARCHITECTURE.md,
// and the same ones host/cloudSignIn.mjs gives its ProviderError on Windows.
final class CloudError extends Exception {
    private static final long serialVersionUID = 1L;
    final String code;
    final long retryAfterMs;

    CloudError(String code, String message) {
        this(code, message, 0);
    }

    CloudError(String code, String message, long retryAfterMs) {
        super(message, null, false, false);
        this.code = code;
        this.retryAfterMs = Math.max(0, retryAfterMs);
    }
}
