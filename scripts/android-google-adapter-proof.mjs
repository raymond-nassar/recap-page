import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceDir = join(root, 'packaging', 'android', 'app', 'src', 'main', 'java',
  'io', 'github', 'raymondnassar', 'recappage', 'prototype');
const source = (name) => readFileSync(join(sourceDir, name), 'utf8');
const adapter = source('AndroidGoogle.java');
const activity = source('GoogleConsentActivity.java');
const tagged = activity.includes('WAITING.take(');
const prepared = /\b(?:CloudAccount\.)?GoogleAttempt\s+authorize\s*\(/.test(adapter);
const base = 'io/github/raymondnassar/recappage/prototype/';

// The actual adapter and activity run against controllable Android and Play services boundaries.
// The old void signature is supported so the same proof fails against the pre-fix implementation.
const sources = {
  [`${base}AndroidGoogle.java`]: adapter,
  [`${base}GoogleConsentActivity.java`]: activity,
  [`${base}CloudAccount.java`]: `package io.github.raymondnassar.recappage.prototype;
import java.util.Collection;
final class CloudAccount {
    static final String GOOGLE_SCOPE = "drive.file";
    interface Google {
        ${prepared ? 'GoogleAttempt' : 'void'} authorize(String account, Consent consent) throws Exception;
        String token(String account, String stale) throws CloudError;
    }
    interface GoogleAttempt {
        void start() throws Exception;
        void cancel();
    }
    interface Consent {
        void granted(String token, Collection<String> scopes);
        void ended(String reason);
    }
}
`,
  [`${base}CloudError.java`]: `package io.github.raymondnassar.recappage.prototype;
final class CloudError extends Exception {
    CloudError(String code, String message) { super(message); }
}
`,
  [`${base}AdapterRaceProof.java`]: `package io.github.raymondnassar.recappage.prototype;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.tasks.Tasks;
import java.util.Collection;

public final class AdapterRaceProof {
    static final class Answer implements CloudAccount.Consent {
        String token;
        String reason;
        int endings;
        public void granted(String value, Collection<String> scopes) { token = value; }
        public void ended(String value) { reason = value; endings++; }
    }
    static Runnable start(AndroidGoogle adapter, Answer answer) throws Exception {
        Object result = AndroidGoogle.class.getDeclaredMethod("authorize", String.class, CloudAccount.Consent.class)
                .invoke(adapter, null, answer);
        if (result instanceof CloudAccount.GoogleAttempt) {
            CloudAccount.GoogleAttempt attempt = (CloudAccount.GoogleAttempt) result;
            attempt.start();
            return attempt::cancel;
        }
        return () -> {};
    }
    static void require(boolean value, String text) {
        if (!value) {
            System.err.println("FAIL: " + text);
            System.exit(1);
        }
    }
    static void lateAuthorization() throws Exception {
        Identity.client.pending.clear();
        Context context = new Context();
        AndroidGoogle adapter = AndroidGoogle.create(context);
        require(adapter != null, "Play services is usable in the stub.");
        Answer oldAttempt = new Answer();
        Answer newAttempt = new Answer();
        Runnable cancelOld = start(adapter, oldAttempt);
        cancelOld.run();
        start(adapter, newAttempt);

        Identity.client.pending.get(1).succeed(new AuthorizationResult(new PendingIntent()));
        require(context.opened.size() == 1, "The current attempt opens its consent screen.");
        Intent newScreenIntent = context.opened.get(0);
        Identity.client.pending.get(0).succeed(new AuthorizationResult(new PendingIntent()));
        require(context.opened.size() == 1 && newAttempt.endings == 0,
                "A cancelled authorization cannot launch or displace the current sign-in.");
        GoogleConsentActivity newScreen = new GoogleConsentActivity();
        newScreen.setIntent(newScreenIntent);
        newScreen.onActivityResult(1, Activity.RESULT_OK, new Intent(new AuthorizationResult("new-account")));
        require("new-account".equals(newAttempt.token) && oldAttempt.token == null,
                "The current screen answers its own attempt.");
        newScreen.onActivityResult(1, Activity.RESULT_OK, new Intent(new AuthorizationResult("duplicate")));
        require("new-account".equals(newAttempt.token), "A consent result is accepted only once.");
        System.out.println("PASS: delayed authorization");
    }
    static void lateScreen() throws Exception {
        Identity.client.pending.clear();
        Context context = new Context();
        AndroidGoogle adapter = AndroidGoogle.create(context);
        Answer oldAttempt = new Answer();
        Answer newAttempt = new Answer();
        Runnable cancelOld = start(adapter, oldAttempt);
        Identity.client.pending.get(0).succeed(new AuthorizationResult(new PendingIntent()));
        Intent oldScreenIntent = context.opened.get(0);
        cancelOld.run();
        start(adapter, newAttempt);
        Identity.client.pending.get(1).succeed(new AuthorizationResult(new PendingIntent()));
        Intent newScreenIntent = context.opened.get(1);
        GoogleConsentActivity oldScreen = new GoogleConsentActivity();
        oldScreen.setIntent(oldScreenIntent);
        oldScreen.onActivityResult(1, Activity.RESULT_OK, new Intent(new AuthorizationResult("old-account")));
        require(newAttempt.token == null && oldAttempt.token == null,
                "A cancelled screen cannot answer a later sign-in.");
        GoogleConsentActivity newScreen = new GoogleConsentActivity();
        newScreen.setIntent(newScreenIntent);
        newScreen.onActivityResult(1, Activity.RESULT_OK, new Intent(new AuthorizationResult("new-account")));
        require("new-account".equals(newAttempt.token), "The current screen keeps its own answer.");
        System.out.println("PASS: delayed screen result");
    }
    static void lateToken() throws Exception {
        Identity.client.pending.clear();
        Context context = new Context();
        AndroidGoogle adapter = AndroidGoogle.create(context);
        Answer oldAttempt = new Answer();
        Answer newAttempt = new Answer();
        Runnable cancelOld = start(adapter, oldAttempt);
        cancelOld.run();
        start(adapter, newAttempt);
        Identity.client.pending.get(0).succeed(new AuthorizationResult("old-account"));
        require(oldAttempt.token == null && newAttempt.token == null,
                "A cancelled authorization cannot deliver an immediate token.");
        Identity.client.pending.get(1).succeed(new AuthorizationResult("new-account"));
        Identity.client.pending.get(1).succeed(new AuthorizationResult("duplicate"));
        require("new-account".equals(newAttempt.token), "A direct token is delivered once.");
        System.out.println("PASS: delayed direct token");
    }
    static void staleLaunch() throws Exception {
        Identity.client.pending.clear();
        Context context = new Context();
        AndroidGoogle adapter = AndroidGoogle.create(context);
        Runnable cancelOld = start(adapter, new Answer());
        Identity.client.pending.get(0).succeed(new AuthorizationResult(new PendingIntent()));
        Intent oldScreenIntent = context.opened.get(0);
        cancelOld.run();
        start(adapter, new Answer());
        Identity.client.pending.get(1).succeed(new AuthorizationResult(new PendingIntent()));
        GoogleConsentActivity oldScreen = new GoogleConsentActivity();
        oldScreen.setIntent(oldScreenIntent);
        oldScreen.onCreate(null);
        require(oldScreen.started == 0 && oldScreen.finished,
                "A queued but cancelled activity cannot launch an obsolete consent screen.");
        GoogleConsentActivity recreated = new GoogleConsentActivity();
        recreated.setIntent(oldScreenIntent);
        recreated.onCreate(new Bundle());
        require(recreated.started == 0 && recreated.finished,
                "A recreated activity for a cancelled attempt cannot remain open.");
        System.out.println("PASS: queued cancelled activity");
    }
    static void noPlayServices() {
        Context context = new Context();
        Log.messages.clear();
        GoogleApiAvailability.status = 1;
        require(AndroidGoogle.create(context) == null, "Unavailable Play services must not offer Google.");
        require(Log.messages.isEmpty(), "Ordinary missing Play services is not an unexpected failure.");
        GoogleApiAvailability.status = 0;
        require(AndroidGoogle.create(context) != null, "Usable Play services should offer Google.");
        for (int failure : new int[] {1, 2}) {
            GoogleApiAvailability.failure = failure;
            require(AndroidGoogle.create(context) == null, "A failed Play services initialization leaves Google unavailable.");
            require(Log.messages.size() == failure
                    && "RecapCloud:Google Drive sign-in could not be initialized.".equals(Log.messages.get(failure - 1)),
                    "Unexpected initialization failures are logged without private details.");
        }
        GoogleApiAvailability.failure = 0;
        System.out.println("PASS: unavailable Play services");
    }
    static void interruptedRenewal() {
        AndroidGoogle adapter = AndroidGoogle.create(new Context());
        Tasks.calls = 0;
        Tasks.interruptNext = true;
        try {
            adapter.token("reader@example.test", "stale");
            require(false, "An interrupted token clear must fail.");
        } catch (CloudError error) {
            require("Google did not answer in time.".equals(error.getMessage()),
                    "The interrupted token clear reports the interruption.");
        }
        require(Thread.currentThread().isInterrupted(), "The interrupted worker keeps its interrupt flag.");
        Thread.interrupted();
        require(Tasks.calls == 1, "An interrupted token clear does not start another authorization.");
        System.out.println("PASS: interrupted token cache clear");
    }
    static void invalidActivity() throws Exception {
        Identity.client.pending.clear();
        Context context = new Context();
        AndroidGoogle adapter = AndroidGoogle.create(context);
        Answer missingScreen = new Answer();
        start(adapter, missingScreen);
        Identity.client.pending.get(0).succeed(new AuthorizationResult(new PendingIntent()));
        Intent malformed = context.opened.get(0).putExtra("recap.google.screen", null);
        GoogleConsentActivity activity = new GoogleConsentActivity();
        activity.setIntent(malformed);
        activity.onCreate(null);
        require("failed".equals(missingScreen.reason) && missingScreen.endings == 1,
                "A missing consent screen is reported as a failure, not a dismissal.");

        Answer missingResult = new Answer();
        start(adapter, missingResult);
        Identity.client.pending.get(1).succeed(new AuthorizationResult(new PendingIntent()));
        GoogleConsentActivity resultActivity = new GoogleConsentActivity();
        resultActivity.setIntent(context.opened.get(1));
        resultActivity.onActivityResult(1, Activity.RESULT_OK, null);
        require("failed".equals(missingResult.reason) && missingResult.endings == 1,
                "A successful activity result without data is reported as a failure.");

        Answer missingPendingIntent = new Answer();
        start(adapter, missingPendingIntent);
        Identity.client.pending.get(2).succeed(new AuthorizationResult((PendingIntent) null));
        Identity.client.pending.get(2).succeed(new AuthorizationResult((PendingIntent) null));
        require("failed".equals(missingPendingIntent.reason) && missingPendingIntent.endings == 1,
                "A missing Play services resolution fails once.");
        System.out.println("PASS: malformed consent responses");
    }
    static void cancelDuringLaunch() throws Exception {
        Identity.client.pending.clear();
        Context context = new Context();
        AndroidGoogle adapter = AndroidGoogle.create(context);
        Runnable cancel = start(adapter, new Answer());
        Intent.beforeFlags = cancel;
        Identity.client.pending.get(0).succeed(new AuthorizationResult(new PendingIntent()));
        require(context.opened.isEmpty(), "Cancellation before activity launch must not open it.");
        System.out.println("PASS: cancellation before activity launch");
    }
    static void cancelDuringScreen() throws Exception {
        Identity.client.pending.clear();
        Context context = new Context();
        AndroidGoogle adapter = AndroidGoogle.create(context);
        Runnable cancel = start(adapter, new Answer());
        Identity.client.pending.get(0).succeed(new AuthorizationResult(new PendingIntent()));
        Intent.beforeParcelable = cancel;
        GoogleConsentActivity activity = new GoogleConsentActivity();
        activity.setIntent(context.opened.get(0));
        activity.onCreate(null);
        require(activity.started == 0 && activity.finished,
                "Cancellation before screen launch must not open the consent screen.");
        System.out.println("PASS: cancellation before consent launch");
    }
    public static void main(String[] args) throws Exception {
        String only = args.length == 0 ? "" : args[0];
        if (!only.isEmpty() && !"late-authorization".equals(only) && !"late-screen".equals(only)
                && !"late-token".equals(only) && !"stale-launch".equals(only)
                && !"no-play-services".equals(only) && !"invalid-activity".equals(only)
                && !"cancel-during-launch".equals(only) && !"cancel-during-screen".equals(only)
                && !"interrupted-renewal".equals(only)) {
            throw new IllegalArgumentException("Unknown test: " + only);
        }
        if (only.isEmpty() || "late-authorization".equals(only)) lateAuthorization();
        if (only.isEmpty() || "late-screen".equals(only)) lateScreen();
        if (only.isEmpty() || "late-token".equals(only)) lateToken();
        if (only.isEmpty() || "stale-launch".equals(only)) staleLaunch();
        if (only.isEmpty() || "no-play-services".equals(only)) noPlayServices();
        if (only.isEmpty() || "interrupted-renewal".equals(only)) interruptedRenewal();
        if (only.isEmpty() || "invalid-activity".equals(only)) invalidActivity();
        if (only.isEmpty() || "cancel-during-launch".equals(only)) cancelDuringLaunch();
        if (only.isEmpty() || "cancel-during-screen".equals(only)) cancelDuringScreen();
    }
}
`,
  'android/accounts/Account.java': `package android.accounts;
public class Account { public Account(String name, String type) {} }
`,
  'android/content/Context.java': `package android.content;
import java.util.ArrayList;
import java.util.List;
public class Context {
    public final List<Intent> opened = new ArrayList<>();
    public void startActivity(Intent intent) { opened.add(intent); }
}
`,
  'android/content/Intent.java': `package android.content;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import java.util.HashMap;
import java.util.Map;
public class Intent {
    public static final int FLAG_ACTIVITY_NEW_TASK = 1;
    public static Runnable beforeFlags;
    public static Runnable beforeParcelable;
    public AuthorizationResult result;
    private final Map<String, Object> extras = new HashMap<>();
    public Intent(Context context, Class<?> activity) {}
    public Intent(AuthorizationResult result) { this.result = result; }
    public Intent putExtra(String key, Object value) { extras.put(key, value); return this; }
    public String getStringExtra(String key) { return (String) extras.get(key); }
    private void beforeRead() {
        if (beforeParcelable != null) {
            Runnable action = beforeParcelable;
            beforeParcelable = null;
            action.run();
        }
    }
    public <T> T getParcelableExtra(String key, Class<T> type) { beforeRead(); return type.cast(extras.get(key)); }
    @SuppressWarnings("unchecked")
    public <T> T getParcelableExtra(String key) { beforeRead(); return (T) extras.get(key); }
    public Intent addFlags(int flags) {
        if (beforeFlags != null) {
            Runnable action = beforeFlags;
            beforeFlags = null;
            action.run();
        }
        return this;
    }
}
`,
  'android/content/IntentSender.java': `package android.content;
public class IntentSender { public static class SendIntentException extends Exception {} }
`,
  'android/app/PendingIntent.java': `package android.app;
import android.content.IntentSender;
public class PendingIntent { public IntentSender getIntentSender() { return new IntentSender(); } }
`,
  'android/app/Activity.java': `package android.app;
import android.content.Context;
import android.content.Intent;
import android.content.IntentSender;
import android.os.Bundle;
public class Activity extends Context {
    public static final int RESULT_OK = -1;
    public int started;
    public boolean finished;
    private Intent intent;
    protected void onCreate(Bundle saved) {}
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {}
    public Intent getIntent() { return intent; }
    public void setIntent(Intent value) { intent = value; }
    public void startIntentSenderForResult(IntentSender sender, int code, Intent intent,
            int flagsMask, int flagsValues, int extraFlags) throws IntentSender.SendIntentException { started++; }
    public void finish() { finished = true; }
}
`,
  'android/os/Bundle.java': 'package android.os; public class Bundle {}\n',
  'android/util/Log.java': `package android.util;
import java.util.ArrayList;
import java.util.List;
public final class Log {
    public static final List<String> messages = new ArrayList<>();
    public static int w(String tag, String message) { messages.add(tag + ":" + message); return 0; }
}
`,
  'android/os/Build.java': `package android.os;
public final class Build {
    public static final class VERSION { public static final int SDK_INT = 36; }
    public static final class VERSION_CODES { public static final int TIRAMISU = 33; }
}
`,
  'com/google/android/gms/common/ConnectionResult.java': `package com.google.android.gms.common;
public final class ConnectionResult { public static final int SUCCESS = 0; }
`,
  'com/google/android/gms/common/GoogleApiAvailability.java': `package com.google.android.gms.common;
import android.content.Context;
public final class GoogleApiAvailability {
    public static int status;
    public static int failure;
    public static GoogleApiAvailability getInstance() { return new GoogleApiAvailability(); }
    public int isGooglePlayServicesAvailable(Context context) {
        if (failure == 1) throw new IllegalStateException("private details");
        if (failure == 2) throw new LinkageError("private details");
        return status;
    }
}
`,
  'com/google/android/gms/common/api/ApiException.java': `package com.google.android.gms.common.api;
public class ApiException extends Exception {}
`,
  'com/google/android/gms/common/api/Scope.java': `package com.google.android.gms.common.api;
public class Scope { public Scope(String scope) {} }
`,
  'com/google/android/gms/tasks/Task.java': `package com.google.android.gms.tasks;
import java.util.function.Consumer;
public class Task<T> {
    private Consumer<T> success;
    private Consumer<Exception> failure;
    public Task<T> addOnSuccessListener(Consumer<T> listener) { success = listener; return this; }
    public Task<T> addOnFailureListener(Consumer<Exception> listener) { failure = listener; return this; }
    public void succeed(T value) { success.accept(value); }
    public void fail(Exception error) { failure.accept(error); }
}
`,
  'com/google/android/gms/tasks/Tasks.java': `package com.google.android.gms.tasks;
import java.util.concurrent.TimeUnit;
public final class Tasks {
    public static int calls;
    public static boolean interruptNext;
    public static <T> T await(Task<T> task, long amount, TimeUnit unit) throws Exception {
        calls++;
        if (interruptNext) { interruptNext = false; throw new InterruptedException(); }
        return null;
    }
}
`,
  'com/google/android/gms/auth/api/identity/AuthorizationRequest.java': `package com.google.android.gms.auth.api.identity;
import android.accounts.Account;
import com.google.android.gms.common.api.Scope;
import java.util.List;
public class AuthorizationRequest {
    public static Builder builder() { return new Builder(); }
    public static final class Builder {
        public Builder setRequestedScopes(List<Scope> scopes) { return this; }
        public Builder setAccount(Account account) { return this; }
        public AuthorizationRequest build() { return new AuthorizationRequest(); }
    }
}
`,
  'com/google/android/gms/auth/api/identity/ClearTokenRequest.java': `package com.google.android.gms.auth.api.identity;
public class ClearTokenRequest {
    public static Builder builder() { return new Builder(); }
    public static final class Builder {
        public Builder setToken(String token) { return this; }
        public ClearTokenRequest build() { return new ClearTokenRequest(); }
    }
}
`,
  'com/google/android/gms/auth/api/identity/AuthorizationResult.java': `package com.google.android.gms.auth.api.identity;
import android.app.PendingIntent;
import java.util.Collection;
import java.util.List;
public class AuthorizationResult {
    private final PendingIntent screen;
    private final String token;
    private final boolean resolution;
    public AuthorizationResult(PendingIntent screen) { this.screen = screen; this.token = null; this.resolution = true; }
    public AuthorizationResult(String token) { this.screen = null; this.token = token; this.resolution = false; }
    public boolean hasResolution() { return resolution; }
    public PendingIntent getPendingIntent() { return screen; }
    public String getAccessToken() { return token; }
    public Collection<String> getGrantedScopes() { return List.of("drive.file"); }
}
`,
  'com/google/android/gms/auth/api/identity/AuthorizationClient.java': `package com.google.android.gms.auth.api.identity;
import android.content.Intent;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.tasks.Task;
import java.util.ArrayList;
import java.util.List;
public class AuthorizationClient {
    public final List<Task<AuthorizationResult>> pending = new ArrayList<>();
    public Task<AuthorizationResult> authorize(AuthorizationRequest request) {
        Task<AuthorizationResult> task = new Task<>();
        pending.add(task);
        return task;
    }
    public Task<Void> clearToken(ClearTokenRequest request) { return new Task<>(); }
    public AuthorizationResult getAuthorizationResultFromIntent(Intent intent) throws ApiException { return intent.result; }
}
`,
  'com/google/android/gms/auth/api/identity/Identity.java': `package com.google.android.gms.auth.api.identity;
import android.content.Context;
public final class Identity {
    public static final AuthorizationClient client = new AuthorizationClient();
    public static AuthorizationClient getAuthorizationClient(Context context) { return client; }
}
`,
};
if (tagged) sources[`${base}CloudGoogleConsent.java`] = source('CloudGoogleConsent.java');

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && !/^--only=.+$/.test(args[0]))) {
  throw new Error('Use at most one --only=<scenario> argument.');
}
const scratch = mkdtempSync(join(tmpdir(), 'recap-google-adapter-'));
try {
  const files = [];
  for (const [name, content] of Object.entries(sources)) {
    const file = join(scratch, ...name.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf8');
    files.push(file);
  }
  const classes = join(scratch, 'classes');
  mkdirSync(classes);
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const java = (name) => process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', `${name}${suffix}`) : name;
  execFileSync(java('javac'), ['--release', '17', '-encoding', 'UTF-8', '-d', classes, ...files], { stdio: 'inherit' });
  const selected = args.length ? [args[0].slice(7)] : [];
  const result = spawnSync(java('java'), ['-cp', classes,
    'io.github.raymondnassar.recappage.prototype.AdapterRaceProof', ...selected], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status === null ? 1 : result.status;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
