package io.github.raymondnassar.recappage.prototype;

// Where the account keeps its one stored sign-in. On a device it is KeystoreVault, which encrypts the record
// under a key the Android Keystore never lets out; the tests keep it in memory. Every failure is a
// CloudError carrying one of the codes below, whose words the page may show.
interface CloudVault {
    String UNREADABLE = "The saved sign-in could not be read on this device, so it has to be made again.";
    String INVALID = "The saved cloud backup sign-in is not one this version can use.";
    String FAILED = "Android could not protect or read the cloud backup sign-in.";

    // Proves a record can be protected and read back here, before Microsoft's page is opened.
    void probe() throws CloudError;

    boolean exists() throws CloudError;

    // Throws code "unreadable" when the stored record cannot be decrypted, which only a new sign-in mends.
    String load() throws CloudError;

    void save(String record) throws CloudError;

    void clear() throws CloudError;
}
