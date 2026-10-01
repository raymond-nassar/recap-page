package io.github.raymondnassar.recappage.prototype;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Binder;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.os.Process;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.nio.file.Files;

/** A separate test-APK provider, not a replacement for the platform document picker. */
public final class FixtureDocumentProvider extends ContentProvider {
    private Uri saved;
    private Uri refused;
    private File document;
    private int targetUid;
    private int reads;
    private int writes;
    private int closedWrites;
    private int refusedWrites;

    static String targetPackage(Context testContext) {
        try {
            Bundle metadata = testContext.getPackageManager().getApplicationInfo(
                    testContext.getPackageName(), PackageManager.GET_META_DATA).metaData;
            String target = metadata == null ? null : metadata.getString("recap.test.target");
            if (!("io.github.raymondnassar.recappage".equals(target)
                    || "io.github.raymondnassar.recappage.prototype".equals(target))
                    || !testContext.getPackageName().equals(target + ".test")) {
                throw new IllegalStateException("Fixture identity must match its explicit test target");
            }
            return target;
        } catch (PackageManager.NameNotFoundException error) {
            throw new IllegalStateException("Fixture target metadata is unavailable", error);
        }
    }

    static Uri saved(Context testContext) {
        return Uri.parse("content://" + targetPackage(testContext) + ".test.documents/document/backup.json");
    }

    static Uri refused(Context testContext) {
        return Uri.parse("content://" + targetPackage(testContext) + ".test.documents/document/refuse.json");
    }

    @Override
    public boolean onCreate() {
        if (getContext() == null) throw new IllegalStateException("Fixture provider has no context");
        document = new File(getContext().getFilesDir(), "native-fixture-backup.json");
        saved = saved(getContext());
        refused = refused(getContext());
        try {
            targetUid = getContext().getPackageManager().getPackageUid(
                    targetPackage(getContext()), 0);
        } catch (PackageManager.NameNotFoundException error) {
            throw new IllegalStateException("The selected instrumentation target is not installed", error);
        }
        return true;
    }

    private void requireTestCaller() {
        int caller = Binder.getCallingUid();
        if (caller != targetUid && caller != Process.myUid()) {
            throw new SecurityException("Only the instrumented app may use synthetic documents");
        }
    }

    private void requireDocument(Uri uri) throws FileNotFoundException {
        requireTestCaller();
        if (!saved.equals(uri) && !refused.equals(uri)) {
            throw new FileNotFoundException("Unknown synthetic document");
        }
    }

    @Override
    public synchronized ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        requireDocument(uri);
        if (mode.contains("w")) {
            if (refused.equals(uri)) {
                refusedWrites++;
                throw new FileNotFoundException("Intentional synthetic provider write refusal");
            }
            writes++;
            try {
                return ParcelFileDescriptor.open(document,
                        ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE
                                | ParcelFileDescriptor.MODE_WRITE_ONLY,
                        new Handler(Looper.getMainLooper()), error -> {
                            synchronized (FixtureDocumentProvider.this) {
                                if (error == null) closedWrites++;
                            }
                        });
            } catch (IOException error) {
                throw new FileNotFoundException(error.getMessage());
            }
        }
        if (!"r".equals(mode) || !saved.equals(uri)) {
            throw new FileNotFoundException("Unsupported synthetic document mode");
        }
        reads++;
        return ParcelFileDescriptor.open(document, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public synchronized Cursor query(Uri uri, String[] projection, String selection,
            String[] selectionArgs, String sortOrder) {
        requireTestCaller();
        if (!saved.equals(uri) && !refused.equals(uri)) return null;
        String[] columns = projection == null
                ? new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE } : projection;
        MatrixCursor cursor = new MatrixCursor(columns);
        MatrixCursor.RowBuilder row = cursor.newRow();
        for (String column : columns) {
            if (OpenableColumns.DISPLAY_NAME.equals(column)) row.add("native-fixture-backup.json");
            else if (OpenableColumns.SIZE.equals(column)) row.add(document.length());
            else row.add(null);
        }
        return cursor;
    }

    @Override
    public String getType(Uri uri) {
        requireTestCaller();
        return saved.equals(uri) || refused.equals(uri) ? "application/json" : null;
    }

    @Override
    public synchronized Bundle call(String method, String arg, Bundle extras) {
        requireTestCaller();
        if ("reset".equals(method)) {
            if (document.exists() && !document.delete()) {
                throw new IllegalStateException("Could not reset synthetic document");
            }
            reads = writes = closedWrites = refusedWrites = 0;
        } else if (!"stats".equals(method) && !"bytes".equals(method)) {
            throw new IllegalArgumentException("Unknown synthetic provider operation");
        }
        Bundle result = new Bundle();
        result.putInt("reads", reads);
        result.putInt("writes", writes);
        result.putInt("closedWrites", closedWrites);
        result.putInt("refusedWrites", refusedWrites);
        result.putLong("length", document.length());
        if ("bytes".equals(method)) {
            try {
                result.putByteArray("bytes", Files.readAllBytes(document.toPath()));
            } catch (IOException error) {
                throw new IllegalStateException("Could not read synthetic document", error);
            }
        }
        return result;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("Synthetic fixture only");
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] args) {
        throw new UnsupportedOperationException("Synthetic fixture only");
    }

    @Override
    public int delete(Uri uri, String selection, String[] args) {
        throw new UnsupportedOperationException("Synthetic fixture only");
    }
}
