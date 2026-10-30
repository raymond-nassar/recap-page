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
import java.security.SecureRandom;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

// The one stored sign-in, encrypted with AES-GCM under a key the Android Keystore generates and never lets
// out of it, so a copy of the file is unreadable anywhere else, this app's other installs included. The
// file sits in the no-backup directory, so Android's own backup never carries it to another device where it
// could not be read. The associated data binds the package, provider and client, so a record written for
// one client is refused by another rather than handed to it.
final class KeystoreVault implements CloudVault {
    private static final int MAX_PLAIN = 64 * 1024;
    private static final byte[] MAGIC = "RECAPCL1".getBytes(StandardCharsets.US_ASCII);
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final int MAX_RECORD = MAX_PLAIN + MAGIC.length + 1 + IV_BYTES + TAG_BITS / 8;
    private static final Object LOCK = new Object();
    private final AtomicFile file;
    private final File backup;
    private final File temporary;
    private final File directory;
    private final String alias;
    private final byte[] binding;

    KeystoreVault(Context context, String clientId) {
        if (!CloudAuthorization.validClientId(clientId)) throw new IllegalArgumentException("A client id is required.");
        String client = CloudRules.hex(CloudAuthorization.sha256(clientId.getBytes(StandardCharsets.UTF_8))).substring(0, 32);
        directory = new File(new File(context.getNoBackupFilesDir(), "cloud-v1"), "onedrive-" + client);
        File base = new File(directory, "sign-in.bin");
        file = new AtomicFile(base);
        // AtomicFile names its in-progress copies by these suffixes, the first before API 30 and the second after.
        backup = new File(base.getPath() + ".bak");
        temporary = new File(base.getPath() + ".new");
        alias = "recap-cloud-v1.onedrive." + client;
        binding = (context.getPackageName() + "\nonedrive\n" + clientId).getBytes(StandardCharsets.UTF_8);
    }

    private static CloudError failed() {
        return new CloudError("failed", FAILED);
    }

    private static CloudError unreadable() {
        return new CloudError("unreadable", UNREADABLE);
    }

    @Override
    public void probe() throws CloudError {
        synchronized (LOCK) {
            try {
                safePaths();
                byte[] sample = new byte[32];
                new SecureRandom().nextBytes(sample);
                SecretKey key = key(true);
                if (!Arrays.equals(sample, decrypt(key, encrypt(key, sample)))) throw failed();
            } catch (GeneralSecurityException | IOException | RuntimeException error) {
                throw failed();
            }
        }
    }

    @Override
    public boolean exists() throws CloudError {
        synchronized (LOCK) {
            try {
                safePaths();
                return file.getBaseFile().exists() || backup.exists() || temporary.exists();
            } catch (IOException | RuntimeException error) {
                throw failed();
            }
        }
    }

    // Anything wrong with the file itself, or a key that no longer opens it, is unreadable: only a new
    // sign-in mends it, and the account clears it to ask for one. A Keystore that cannot be reached at all
    // is failed instead, and nothing is cleared, since the record may read again once it can be.
    @Override
    public String load() throws CloudError {
        synchronized (LOCK) {
            KeyStore store;
            try {
                safePaths();
                store = keyStore();
            } catch (GeneralSecurityException | IOException | RuntimeException error) {
                throw failed();
            }
            try {
                // A write that never finished is not adopted in silence, even where AtomicFile would.
                if (backup.exists() || temporary.exists()) throw unreadable();
                if (!file.getBaseFile().exists()) return null;
                if (!file.getBaseFile().isFile() || file.getBaseFile().length() > MAX_RECORD) throw unreadable();
                Key key = store.getKey(alias, null);
                if (!(key instanceof SecretKey)) throw unreadable();
                byte[] plain = decrypt((SecretKey) key, read());
                String value = new String(plain, StandardCharsets.UTF_8);
                if (plain.length == 0 || !Arrays.equals(plain, value.getBytes(StandardCharsets.UTF_8))) throw unreadable();
                return value;
            } catch (GeneralSecurityException | IOException | RuntimeException error) {
                throw unreadable();
            }
        }
    }

    @Override
    public void save(String record) throws CloudError {
        byte[] plain = record == null ? new byte[0] : record.getBytes(StandardCharsets.UTF_8);
        if (plain.length == 0 || plain.length > MAX_PLAIN) throw failed();
        synchronized (LOCK) {
            FileOutputStream output = null;
            try {
                safePaths();
                if (!directory.isDirectory() && !directory.mkdirs()) throw failed();
                SecretKey key = key(true);
                byte[] sealed = encrypt(key, plain);
                output = file.startWrite();
                output.write(sealed);
                output.getFD().sync();
                file.finishWrite(output);
                output = null;
                // Read back before the record is relied on, so a key that cannot open what it sealed is found
                // now rather than at the next start.
                if (!Arrays.equals(plain, decrypt(key, read()))) throw failed();
            } catch (GeneralSecurityException | IOException | RuntimeException error) {
                if (output != null) file.failWrite(output);
                throw failed();
            }
        }
    }

    @Override
    public void clear() throws CloudError {
        synchronized (LOCK) {
            try {
                safePaths();
                file.delete();
                Files.deleteIfExists(file.getBaseFile().toPath());
                Files.deleteIfExists(backup.toPath());
                Files.deleteIfExists(temporary.toPath());
                KeyStore store = keyStore();
                if (store.containsAlias(alias)) store.deleteEntry(alias);
                if (file.getBaseFile().exists() || backup.exists() || temporary.exists() || store.containsAlias(alias)) {
                    throw failed();
                }
            } catch (GeneralSecurityException | IOException | RuntimeException error) {
                throw failed();
            }
        }
    }

    private void safePaths() throws IOException {
        for (File path : new File[] {directory.getParentFile(), directory, file.getBaseFile(), backup, temporary}) {
            if (Files.isSymbolicLink(path.toPath())) throw new IOException("link");
        }
    }

    private byte[] read() throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (FileInputStream input = file.openRead()) {
            byte[] chunk = new byte[8192];
            int count;
            while ((count = input.read(chunk)) != -1) {
                if (bytes.size() + count > MAX_RECORD) throw new IOException("too large");
                bytes.write(chunk, 0, count);
            }
        }
        return bytes.toByteArray();
    }

    private static KeyStore keyStore() throws GeneralSecurityException, IOException {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        return store;
    }

    // A key is made only while no record exists, so a record whose key has gone stays unreadable rather
    // than being paired with a new key that could never open it.
    private SecretKey key(boolean create) throws GeneralSecurityException, IOException {
        KeyStore store = keyStore();
        if (!store.containsAlias(alias)) {
            if (!create || file.getBaseFile().exists() || backup.exists() || temporary.exists()) throw new IOException("no key");
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setRandomizedEncryptionRequired(true)
                    .setUserAuthenticationRequired(false)
                    .build());
            generator.generateKey();
        }
        Key key = store.getKey(alias, null);
        if (!(key instanceof SecretKey)) throw new IOException("not a secret key");
        return (SecretKey) key;
    }

    private byte[] encrypt(SecretKey key, byte[] plain) throws GeneralSecurityException, IOException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        cipher.updateAAD(binding);
        byte[] iv = cipher.getIV();
        if (iv == null || iv.length != IV_BYTES) throw new IOException("iv");
        byte[] sealed = cipher.doFinal(plain);
        return ByteBuffer.allocate(MAGIC.length + 1 + iv.length + sealed.length)
                .put(MAGIC).put((byte) iv.length).put(iv).put(sealed).array();
    }

    private byte[] decrypt(SecretKey key, byte[] sealed) throws GeneralSecurityException, IOException {
        if (sealed.length < MAGIC.length + 1 + IV_BYTES + TAG_BITS / 8
                || !Arrays.equals(MAGIC, Arrays.copyOf(sealed, MAGIC.length))
                || sealed[MAGIC.length] != IV_BYTES) throw new IOException("format");
        byte[] iv = Arrays.copyOfRange(sealed, MAGIC.length + 1, MAGIC.length + 1 + IV_BYTES);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
        cipher.updateAAD(binding);
        return cipher.doFinal(sealed, MAGIC.length + 1 + IV_BYTES, sealed.length - MAGIC.length - 1 - IV_BYTES);
    }
}
