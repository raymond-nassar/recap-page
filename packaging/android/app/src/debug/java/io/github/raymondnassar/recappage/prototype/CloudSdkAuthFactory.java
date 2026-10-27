package io.github.raymondnassar.recappage.prototype;

import android.accounts.Account;
import android.app.Activity;
import android.app.Application;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;

import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Tasks;

import net.openid.appauth.AuthState;

import java.io.IOException;
import java.lang.ref.WeakReference;
import java.util.Arrays;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

final class CloudSdkAuthFactory implements CloudService.AuthFactory, AutoCloseable {
    private static Pending live;
    private final Context context;
    private final WeakReference<Activity> owner;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Application.ActivityLifecycleCallbacks lifecycle;
    private volatile boolean resumed, closed;

    CloudSdkAuthFactory(Activity activity) throws Exception {
        this(activity, activity == null ? null : activity.getApplicationContext());
    }

    CloudSdkAuthFactory(Activity activity, Context nativeContext) throws Exception {
        if (activity == null || Looper.myLooper() != Looper.getMainLooper()) throw CloudNativeAuth.failure();
        if (Build.VERSION.SDK_INT < 28 || !(activity.getPackageName() + ":cloudCandidate").equals(Application.getProcessName())) {
            throw CloudNativeAuth.failure();
        }
        CloudMicrosoftAuth.requireNative(activity);
        if (nativeContext == null || !activity.getPackageName().equals(nativeContext.getPackageName())) throw CloudNativeAuth.failure();
        context = nativeContext.getApplicationContext();
        owner = new WeakReference<>(activity);
        resumed = activity.hasWindowFocus() && !activity.isFinishing() && !activity.isDestroyed();
        lifecycle = new Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityResumed(Activity value) { if (owner.get() == value) resumed = true; }
            @Override public void onActivityPaused(Activity value) { if (owner.get() == value) resumed = false; }
            @Override public void onActivityDestroyed(Activity value) { if (owner.get() == value) close(); }
            @Override public void onActivityCreated(Activity value, Bundle state) {}
            @Override public void onActivityStarted(Activity value) {}
            @Override public void onActivityStopped(Activity value) {}
            @Override public void onActivitySaveInstanceState(Activity value, Bundle state) {}
        };
        activity.getApplication().registerActivityLifecycleCallbacks(lifecycle);
    }
    @Override public String clientId(CloudProviderHttp.Provider provider) throws IOException {
        if (closed || provider == null) throw CloudNativeAuth.failure();
        return provider == CloudProviderHttp.Provider.GOOGLE ? CloudGoogleAuth.CLIENT : CloudMicrosoftAuth.CLIENT;
    }
    @Override public CloudService.Auth open(String profile, CloudProviderHttp.Provider provider, long epoch) throws Exception {
        String client = clientId(provider);
        return new CloudNativeAuth(context.getNoBackupFilesDir().getCanonicalFile().toPath(), profile, provider, client, epoch,
                () -> {
                    CloudCredentialStore store = new CloudCredentialStore(context, profile, CloudOwnership.provider(provider), client);
                    return new CloudSessions.Protected() {
                        @Override public String load() throws IOException { return store.load(); }
                        @Override public void save(String value) throws IOException { store.save(value); }
                        @Override public void clear() throws IOException { store.clear(); }
                        @Override public boolean present() throws IOException { return store.present(); }
                    };
                }, new CloudNativeAuth.Driver() {
                    @Override public boolean current() { return !closed; }
                    @Override public void validate(CloudNativeAuth.Cached cached) throws Exception {
                        if (closed) throw CloudNativeAuth.failure();
                        if (provider == CloudProviderHttp.Provider.MICROSOFT) {
                            if (!CloudMicrosoftAuth.cached(cached.material, cached.id).label.equals(cached.label)) throw CloudNativeAuth.failure();
                        } else if (cached.material.length() > 1024 || !cached.material.equals(cached.label)) throw CloudNativeAuth.failure();
                    }
                    @Override public CloudNativeAuth.Proof reuse(CloudNativeAuth.Cached cached) throws Exception {
                        if (closed) throw CloudNativeAuth.failure();
                        if (provider != CloudProviderHttp.Provider.MICROSOFT) return null;
                        CloudMicrosoftAuth.Identity identity = CloudMicrosoftAuth.reusable(cached.material, cached.id);
                        return identity == null ? null : new CloudNativeAuth.Proof(identity.id, identity.label, cached.material,
                                AuthState.jsonDeserialize(identity.state).getAccessToken());
                    }
                    @Override public CloudNativeAuth.Proof connect(CloudNativeAuth.Request request) throws Exception {
                        return interactive(request);
                    }
                    @Override public CloudNativeAuth.Proof refresh(CloudNativeAuth.Request request, CloudNativeAuth.Cached cached) throws Exception {
                        if (closed || Looper.myLooper() == Looper.getMainLooper()) throw CloudNativeAuth.failure();
                        request.require();
                        if (provider == CloudProviderHttp.Provider.MICROSOFT) {
                            CloudMicrosoftAuth.Identity identity = CloudMicrosoftAuth.access(cached.material, cached.id);
                            request.claim();
                            return microsoft(identity);
                        }
                        googleAvailable(context);
                        AuthorizationResult result = Tasks.await(Identity.getAuthorizationClient(context)
                                .authorize(googleRequest(cached.material)), 30, TimeUnit.SECONDS);
                        request.claim();
                        return CloudGoogleAuth.verify(result, request, cached);
                    }
                    @Override public void cancel(CloudNativeAuth.Request request) { withdraw(request); }
                }, SystemClock::elapsedRealtime);
    }
    static AuthorizationRequest googleRequest(String email) {
        AuthorizationRequest.Builder request = AuthorizationRequest.builder().setRequestedScopes(Arrays.asList(
                new Scope(CloudGoogleAuth.DRIVE), new Scope("openid"), new Scope("email"))).setOptOutIncludingGrantedScopes(true);
        if (email != null) request.setAccount(new Account(email, "com.google"));
        return request.build();
    }
    static void googleAvailable(Context context) throws IOException {
        if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) != ConnectionResult.SUCCESS) {
            throw new IOException("Google Play services are unavailable. Cloud connection requires supported native services.");
        }
    }
    static CloudNativeAuth.Proof microsoft(CloudMicrosoftAuth.Identity identity) throws Exception {
        return new CloudNativeAuth.Proof(identity.id, identity.label, identity.state, AuthState.jsonDeserialize(identity.state).getAccessToken());
    }
    private CloudNativeAuth.Proof interactive(CloudNativeAuth.Request request) throws Exception {
        if (closed || Looper.myLooper() == Looper.getMainLooper()) throw CloudNativeAuth.failure();
        request.require();
        Pending pending = new Pending(this, request);
        synchronized (CloudSdkAuthFactory.class) {
            if (live != null) {
                if (live.current()) throw CloudNativeAuth.failure();
                live.fail();
            }
            live = pending;
        }
        main.post(() -> {
            Activity activity = owner.get();
            PowerManager power = context.getSystemService(PowerManager.class);
            KeyguardManager keyguard = context.getSystemService(KeyguardManager.class);
            String refusal = !pending.current() ? "stale-request" : closed ? "closed-owner" : !resumed ? "owner-not-resumed"
                    : activity == null || activity.isFinishing() || activity.isDestroyed() ? "owner-unavailable"
                    : !activity.hasWindowFocus() ? "owner-not-focused"
                    : power == null || !power.isInteractive() ? "screen-not-interactive"
                    : keyguard == null || keyguard.isKeyguardLocked() ? "keyguard-unavailable-or-locked" : null;
            if (refusal != null) {
                android.util.Log.e("RecapCloudSdk", "Native sign-in entry refused: " + refusal);
                pending.fail();
                return;
            }
            try {
                activity.startActivity(new Intent(activity, CloudAuthActivity.class)
                        .putExtra("nonce", request.nonce).putExtra("profile", request.profile)
                        .putExtra("provider", CloudOwnership.provider(request.provider))
                        .putExtra("client", request.client).putExtra("epoch", request.epoch));
            } catch (RuntimeException error) {
                android.util.Log.e("RecapCloudSdk", "Android refused the native sign-in activity launch.");
                pending.fail();
            }
        });
        try {
            while (true) {
                request.require();
                try { return pending.result.get(100, TimeUnit.MILLISECONDS); }
                catch (TimeoutException waiting) { /* Native withdrawal and the auth deadline remain observable while SDK UI is open. */ }
                catch (ExecutionException error) { throw CloudNativeAuth.failure(); }
            }
        } finally { withdraw(request); }
    }
    static final class Pending {
        final CloudSdkAuthFactory factory;
        final CloudNativeAuth.Request request;
        final CompletableFuture<CloudNativeAuth.Proof> result = new CompletableFuture<>();
        private WeakReference<CloudAuthActivity> activity = new WeakReference<>(null);
        private boolean attached;
        private volatile boolean withdrawn;
        Pending(CloudSdkAuthFactory factory, CloudNativeAuth.Request request) { this.factory = factory; this.request = request; }
        boolean current() { return !withdrawn && !factory.closed && request.current(); }
        void complete(CloudNativeAuth.Proof proof) throws IOException {
            if (!current() || !result.complete(proof)) throw CloudNativeAuth.failure();
        }
        void fail() {
            withdrawn = true;
            result.completeExceptionally(CloudNativeAuth.failure());
            factory.main.post(() -> { CloudAuthActivity held = activity.get(); if (held != null) held.finish(); });
        }
    }
    static synchronized Pending attach(CloudAuthActivity activity, Intent intent) {
        Pending pending = live;
        if (pending == null || !pending.current() || pending.attached
                || !pending.request.nonce.equals(intent.getStringExtra("nonce"))
                || !pending.request.profile.equals(intent.getStringExtra("profile"))
                || !pending.request.client.equals(intent.getStringExtra("client"))
                || !CloudOwnership.provider(pending.request.provider).equals(intent.getStringExtra("provider"))
                || pending.request.epoch != intent.getLongExtra("epoch", -1)) return null;
        pending.attached = true;
        pending.activity = new WeakReference<>(activity);
        return pending;
    }
    static synchronized boolean deliverMicrosoft(android.net.Uri uri) {
        CloudAuthActivity activity = live == null ? null : live.activity.get();
        return live != null && live.current() && activity != null && activity.microsoft(uri);
    }
    private static synchronized void withdraw(CloudNativeAuth.Request request) {
        if (live != null && live.request == request) {
            Pending pending = live;
            live = null;
            pending.fail();
        }
    }
    @Override public void close() {
        closed = true;
        Activity activity = owner.get();
        if (activity != null) activity.getApplication().unregisterActivityLifecycleCallbacks(lifecycle);
        synchronized (CloudSdkAuthFactory.class) {
            if (live != null && live.factory == this) withdraw(live.request);
        }
        owner.clear();
    }
}
