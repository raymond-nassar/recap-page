package io.github.raymondnassar.recappage.prototype;

import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import java.security.SecureRandom;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

// The one cloud account for the process, so a sign-in under way outlives the activity that started it: the
// browser can take long enough that Android destroys and recreates MainActivity before the redirect arrives.
//
// Cloud backup exists in a build only when the build was given a client configuration. Gradle then adds the
// redirect activity with the client id and the redirect's signature hash as its meta-data, and nothing else
// carries either value. A build without them has no redirect activity, so get() finds nothing and every
// cloud request is answered 404, as the Windows host answers when it has no configuration. The hash is the
// registered string itself, never read from the installed signer, so the same code signs in on a Play-signed
// install and on a test copy built here (OD-07), each with its own registered redirect.
final class AndroidCloud {
    static final String CLIENT = "recap.cloud.client";
    static final String REDIRECT_HASH = "recap.cloud.redirectHash";
    // "true" only in a build given -PrecapGoogleDriveAndroid=true, so Google Drive stays off until it is switched on.
    static final String GOOGLE = "recap.cloud.google";

    private static final ThreadFactory DAEMONS = work -> {
        Thread thread = new Thread(work, "recap-cloud");
        thread.setDaemon(true);
        return thread;
    };
    // A request from the page is run here, and turned away when every place is taken. The account turns away
    // the seventeenth at once, so the few places above that are for its refusals to be answered.
    private static final ThreadPoolExecutor REQUESTS = new ThreadPoolExecutor(
            0, CloudAccount.MAX_IN_FLIGHT + 4, 30, TimeUnit.SECONDS, new SynchronousQueue<>(), DAEMONS);
    private static boolean looked;
    private static AndroidCloud instance;

    final CloudAccount account;

    private AndroidCloud(Context app, String clientId, String redirectUri, boolean offerGoogle) {
        ExecutorService workers = Executors.newCachedThreadPool(DAEMONS);
        ScheduledExecutorService timers = Executors.newSingleThreadScheduledExecutor(DAEMONS);
        Handler main = new Handler(Looper.getMainLooper());
        account = new CloudAccount(new HttpsNetwork(), new KeystoreVault(app, clientId),
                url -> open(app, main, url),
                (task, delayMs) -> {
                    ScheduledFuture<?> future = timers.schedule(task, delayMs, TimeUnit.MILLISECONDS);
                    return () -> future.cancel(false);
                },
                workers, System::currentTimeMillis, new SecureRandom(), clientId, redirectUri, CloudAccount.DEADLINES_MS,
                offerGoogle ? AndroidGoogle.create(app) : null);
    }

    // Null when this build has no cloud backup.
    static synchronized AndroidCloud get(Context context) {
        if (looked) return instance;
        looked = true;
        Context app = context.getApplicationContext();
        try {
            ActivityInfo info = app.getPackageManager().getActivityInfo(
                    new ComponentName(app, SignInRedirectActivity.class), PackageManager.GET_META_DATA);
            Bundle meta = info.metaData;
            String clientId = meta == null ? null : meta.getString(CLIENT);
            String hash = meta == null ? null : meta.getString(REDIRECT_HASH);
            if (!CloudAuthorization.validClientId(clientId) || !CloudAuthorization.validHash(hash)) return null;
            // The manifest reads a value of "true" back as a boolean, so getString would never see it.
            boolean google = meta != null && meta.getBoolean(GOOGLE, false);
            instance = new AndroidCloud(app, clientId, CloudAuthorization.redirectUri(app.getPackageName(), hash), google);
        } catch (PackageManager.NameNotFoundException | IllegalArgumentException error) {
            instance = null;
        }
        return instance;
    }

    // False when every place is taken, for the caller to answer the page itself.
    static boolean run(Runnable work) {
        try {
            REQUESTS.execute(work);
            return true;
        } catch (RejectedExecutionException error) {
            return false;
        }
    }

    // Microsoft's page in the person's own browser, as a Custom Tab where the browser offers one. The session
    // extra is the documented way to ask for one without the Custom Tabs library, and a browser without them
    // opens the page as an ordinary tab. Never a WebView: the page is the provider's, and its password field
    // belongs in the browser the person trusts.
    private static void open(Context app, Handler main, String url) throws Exception {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Bundle extras = new Bundle();
        extras.putBinder("android.support.customtabs.extra.SESSION", null);
        intent.putExtras(extras);
        AtomicReference<Exception> failure = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        main.post(() -> {
            try {
                app.startActivity(intent);
            } catch (ActivityNotFoundException | SecurityException error) {
                failure.set(error);
            } finally {
                done.countDown();
            }
        });
        if (!done.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("The browser did not open in time.");
        if (failure.get() != null) throw failure.get();
    }
}
