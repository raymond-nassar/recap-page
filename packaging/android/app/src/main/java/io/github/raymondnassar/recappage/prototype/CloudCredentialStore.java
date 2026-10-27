package io.github.raymondnassar.recappage.prototype;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.GeneralSecurityException;
import java.security.Key;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class CloudCredentialStore {
    static final int MAX_BYTES = 1024 * 1024;
    private static final byte[] MAGIC = "RECAPCL1".getBytes(StandardCharsets.US_ASCII);
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final int MAX_RECORD = MAX_BYTES + MAGIC.length + 1 + IV_BYTES + TAG_BITS / 8;
    private static final Object OWNER_LOCK = new Object();
    private final AtomicFile record;
    private final File backup;
    private final File temporary;
    private final String alias;
    private final byte[] binding;
    private final File uploadDirectory;

    static final class Failure extends IOException {
        Failure() {
            super("Protected cloud credentials are unavailable or inconsistent. Preserve their files or disconnect before reconnecting. Local reading data is unchanged.");
        }
    }

    CloudCredentialStore(Context context, String profileId, String provider, String clientId) throws IOException {
        this(context, profileId, provider, clientId, false);
    }

    CloudCredentialStore(Context context, String profileId, String provider, String clientId, boolean uploadSession) throws IOException {
        if (context == null || profileId == null || !profileId.matches("[a-f0-9]{64}")
                || !("google".equals(provider) || "microsoft".equals(provider))
                || clientId == null || !clientId.matches("[A-Za-z0-9._:-]{1,256}")) {
            throw new IllegalArgumentException("Cloud credentials require an exact native profile, provider and client.");
        }
        synchronized (OWNER_LOCK) {
            try {
                String client = hex(MessageDigest.getInstance("SHA-256").digest(
                        clientId.getBytes(StandardCharsets.UTF_8)));
                File directory = context.getNoBackupFilesDir().getCanonicalFile();
                String namespace = uploadSession ? "cloud-upload-v1" : "cloud-auth-v1";
                for (String segment : new String[] { namespace, profileId, provider, client }) {
                    directory = new File(directory, segment);
                    if (Files.isSymbolicLink(directory.toPath())
                            || (!directory.exists() && !directory.mkdir())
                            || !directory.isDirectory()) throw new Failure();
                }
                File base = new File(directory, "credentials.bin");
                uploadDirectory = uploadSession ? directory : null;
                record = new AtomicFile(base);
                backup = new File(base.getPath() + ".bak");
                temporary = new File(base.getPath() + ".new");
                alias = (uploadSession ? "recap-cloud-upload-v1." : "recap-cloud-v1.") + profileId + "." + provider + "." + client;
                binding = (context.getPackageName() + "\n" + (uploadSession ? namespace + "\n" : "") + profileId + "\n" + provider + "\n" + clientId)
                        .getBytes(StandardCharsets.UTF_8);
                safeFiles();
            } catch (GeneralSecurityException | SecurityException error) {
                throw new Failure();
            }
        }
    }

    boolean present() throws IOException {
        synchronized (OWNER_LOCK) {
            try {
                safeFiles();
                return record.getBaseFile().exists() || backup.exists() || temporary.exists() || keyStore().containsAlias(alias);
            } catch (GeneralSecurityException | RuntimeException error) { throw new Failure(); }
        }
    }

    String load() throws IOException {
        synchronized (OWNER_LOCK) {
            try {
                return loadProtected();
            } catch (GeneralSecurityException | IOException | RuntimeException error) {
                throw new Failure();
            }
        }
    }

    void save(String value) throws IOException {
        if (value == null || value.isEmpty() || value.length() > MAX_BYTES) throw new Failure();
        byte[] plain = value.getBytes(StandardCharsets.UTF_8);
        if (plain.length > MAX_BYTES || !value.equals(new String(plain, StandardCharsets.UTF_8))) throw new Failure();
        synchronized (OWNER_LOCK) {
            FileOutputStream output = null;
            try {
                safeFiles();
                if (backup.exists() || temporary.exists()) throw new Failure();
                SecretKey key = key(true);
                byte[] probe = new byte[32];
                new SecureRandom().nextBytes(probe);
                if (!Arrays.equals(probe, decrypt(key, encrypt(key, probe)))) throw new Failure();
                byte[] ciphertext = encrypt(key, plain);
                output = record.startWrite();
                output.write(ciphertext);
                output.getFD().sync();
                record.finishWrite(output);
                output = null;
                if (!value.equals(loadProtected())) throw new Failure();
            } catch (GeneralSecurityException | IOException | RuntimeException error) {
                if (output != null) record.failWrite(output);
                throw new Failure();
            }
        }
    }

    void clear() throws IOException {
        synchronized (OWNER_LOCK) {
            try {
                safeFiles();
                record.delete();
                Files.deleteIfExists(record.getBaseFile().toPath());
                Files.deleteIfExists(backup.toPath());
                Files.deleteIfExists(temporary.toPath());
                KeyStore store = keyStore();
                if (store.containsAlias(alias)) store.deleteEntry(alias);
                if (record.getBaseFile().exists() || backup.exists() || temporary.exists()
                        || store.containsAlias(alias)) throw new Failure();
                if (uploadDirectory != null) CloudJournal.pruneUploadDirectory(uploadDirectory.toPath());
            } catch (GeneralSecurityException | IOException | RuntimeException error) {
                throw new Failure();
            }
        }
    }

    private void safeFiles() throws IOException {
        if (Files.isSymbolicLink(record.getBaseFile().toPath()) || Files.isSymbolicLink(backup.toPath())
                || Files.isSymbolicLink(temporary.toPath())) throw new Failure();
    }

    private String loadProtected() throws IOException, GeneralSecurityException {
        safeFiles();
        // Incomplete writes stay visible; do not let AtomicFile silently adopt an older cache.
        if (backup.exists() || temporary.exists()) throw new Failure();
        if (!record.getBaseFile().exists()) return null;
        if (!record.getBaseFile().isFile() || record.getBaseFile().length() > MAX_RECORD) throw new Failure();
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (FileInputStream input = record.openRead()) {
            byte[] chunk = new byte[8192];
            int count;
            while ((count = input.read(chunk)) != -1) {
                if (bytes.size() + count > MAX_RECORD) throw new Failure();
                bytes.write(chunk, 0, count);
            }
        }
        byte[] plain = decrypt(key(false), bytes.toByteArray());
        if (plain.length == 0 || plain.length > MAX_BYTES) throw new Failure();
        String value = new String(plain, StandardCharsets.UTF_8);
        if (!Arrays.equals(plain, value.getBytes(StandardCharsets.UTF_8))) throw new Failure();
        return value;
    }

    private KeyStore keyStore() throws GeneralSecurityException, IOException {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        return store;
    }

    private SecretKey key(boolean create) throws GeneralSecurityException, IOException {
        KeyStore store = keyStore();
        if (!store.containsAlias(alias)) {
            if (!create || record.getBaseFile().exists() || backup.exists() || temporary.exists()) throw new Failure();
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setRandomizedEncryptionRequired(true)
                    .setUserAuthenticationRequired(false)
                    .build());
            generator.generateKey();
        }
        Key key = store.getKey(alias, null);
        if (!(key instanceof SecretKey)) throw new Failure();
        return (SecretKey) key;
    }

    private byte[] encrypt(SecretKey key, byte[] plain) throws GeneralSecurityException, IOException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        cipher.updateAAD(binding);
        byte[] iv = cipher.getIV();
        if (iv.length != IV_BYTES) throw new Failure();
        byte[] protectedBytes = cipher.doFinal(plain);
        return ByteBuffer.allocate(MAGIC.length + 1 + iv.length + protectedBytes.length)
                .put(MAGIC).put((byte) iv.length).put(iv).put(protectedBytes).array();
    }

    private byte[] decrypt(SecretKey key, byte[] protectedBytes) throws GeneralSecurityException, IOException {
        if (protectedBytes.length < MAGIC.length + 1 + IV_BYTES + TAG_BITS / 8
                || !Arrays.equals(MAGIC, Arrays.copyOf(protectedBytes, MAGIC.length))
                || protectedBytes[MAGIC.length] != IV_BYTES) throw new Failure();
        byte[] iv = Arrays.copyOfRange(protectedBytes, MAGIC.length + 1, MAGIC.length + 1 + IV_BYTES);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
        cipher.updateAAD(binding);
        return cipher.doFinal(protectedBytes, MAGIC.length + 1 + IV_BYTES,
                protectedBytes.length - MAGIC.length - 1 - IV_BYTES);
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        return result.toString();
    }
}
