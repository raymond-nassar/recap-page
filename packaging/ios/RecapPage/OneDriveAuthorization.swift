#if RECAP_ICLOUD || DEBUG
import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

/// The Microsoft sign-in, as the Android app's CloudAuthorization and CloudMicrosoft make it: the
/// authorization code flow with PKCE against the consumers authority, in the system's own sign-in sheet,
/// with no Microsoft library. Only personal Microsoft accounts can sign in.
struct OneDriveAuthorization {
    static let login = "https://login.microsoftonline.com/consumers/oauth2/v2.0"
    // openid and profile give the id token whose nonce ties a sign-in to this request and whose name is
    // shown as the account; offline_access gives the refresh token; the app folder is the only storage.
    static let scope = "openid profile offline_access Files.ReadWrite.AppFolder"
    static let callbackScheme = "msauth.io.github.raymondnassar.recappage"
    /// Exactly the redirect registered for the app's bundle in Microsoft Entra.
    static let redirectUri = "\(callbackScheme)://auth"

    let state: String
    let nonce: String
    let verifier: String

    var challenge: String { OneDriveRules.base64Url(Data(SHA256.hash(data: Data(verifier.utf8)))) }

    init(random: (Int) -> Data) {
        state = OneDriveRules.base64Url(random(32))
        nonce = OneDriveRules.base64Url(random(32))
        verifier = OneDriveRules.base64Url(random(32))
    }

    static func validClientId(_ clientId: String) -> Bool {
        clientId.range(of: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$", options: .regularExpression) != nil
    }

    func url(clientId: String) -> URL? {
        let query = OneDriveRules.form([
            ("client_id", clientId), ("response_type", "code"), ("redirect_uri", Self.redirectUri),
            ("response_mode", "query"), ("scope", Self.scope), ("state", state), ("nonce", nonce),
            ("code_challenge", challenge), ("code_challenge_method", "S256"), ("prompt", "select_account"),
        ])
        return URL(string: "\(Self.login)/authorize?\(query)")
    }

    enum Answer: Equatable {
        case code(String)
        case ended(String)
    }

    /// What came back to the redirect: nil when it is not an answer to this sign-in; otherwise the code, or
    /// the reason it ended, as host/cloudSignIn.mjs names them.
    func answer(_ received: String) -> Answer? {
        var received = received
        if let fragment = received.firstIndex(of: "#") { received = String(received[..<fragment]) }
        let mark = received.firstIndex(of: "?")
        let target = mark.map { String(received[..<$0]) } ?? received
        guard let given = OneDriveRules.decode(target, plusIsSpace: false),
              given == OneDriveRules.decode(Self.redirectUri, plusIsSpace: false) else { return nil }
        var params: [String: String] = [:]
        if let mark {
            let query = received[received.index(after: mark)...]
            for pair in query.split(separator: "&", omittingEmptySubsequences: true) {
                let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
                guard let name = OneDriveRules.decode(String(parts[0]), plusIsSpace: true),
                      let value = OneDriveRules.decode(parts.count > 1 ? String(parts[1]) : "", plusIsSpace: true) else {
                    return nil
                }
                // A repeated parameter could be read two ways, so nothing carrying one is taken as an answer.
                guard params.updateValue(value, forKey: name) == nil else { return nil }
            }
        }
        guard let givenState = params["state"], OneDriveRules.constantTimeEqual(givenState, state) else { return nil }
        let error = params["error"]
        guard error == nil, let code = params["code"], !code.isEmpty else {
            return .ended(error == "access_denied" ? "declined" : "refused")
        }
        return .code(code)
    }
}

enum OneDriveSignInEnding: Error {
    case cancelled
    case failed
}

/// Opens the sign-in page and hands back the address Microsoft redirected to. Tests stand in a fake.
@MainActor
protocol OneDriveSignInLauncher: AnyObject {
    /// False when the sign-in sheet could not be opened.
    func start(url: URL, completion: @escaping @MainActor (Result<URL, OneDriveSignInEnding>) -> Void) -> Bool
    func cancel()
}

private final class OneDriveAnchor: NSObject, ASWebAuthenticationPresentationContextProviding {
    let window: UIWindow

    init(window: UIWindow) {
        self.window = window
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        window
    }
}

/// The system's web authentication sheet. It is ephemeral, so no Microsoft cookie outlives the sign-in and
/// Disconnect followed by Connect always asks which account to use.
@MainActor
final class OneDriveBrowserSignIn: OneDriveSignInLauncher {
    private let window: () -> UIWindow?
    private var session: ASWebAuthenticationSession?
    private var anchor: OneDriveAnchor?

    init(window: @escaping () -> UIWindow?) {
        self.window = window
    }

    func start(url: URL, completion: @escaping @MainActor (Result<URL, OneDriveSignInEnding>) -> Void) -> Bool {
        guard let window = window() else { return false }
        let anchor = OneDriveAnchor(window: window)
        let session = ASWebAuthenticationSession(
            url: url,
            callback: .customScheme(OneDriveAuthorization.callbackScheme)
        ) { [weak self] answer, error in
            let cancelled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
            Task { @MainActor in
                self?.session = nil
                self?.anchor = nil
                if let answer {
                    completion(.success(answer))
                } else {
                    completion(.failure(cancelled ? .cancelled : .failed))
                }
            }
        }
        session.prefersEphemeralWebBrowserSession = true
        session.presentationContextProvider = anchor
        self.session = session
        self.anchor = anchor
        guard session.start() else {
            self.session = nil
            self.anchor = nil
            return false
        }
        return true
    }

    func cancel() {
        session?.cancel()
        session = nil
        anchor = nil
    }
}

/// Microsoft's token endpoint and the id token's claims, as the Android app's CloudMicrosoft reads them.
enum OneDriveMicrosoft {
    static let metadataSeconds: TimeInterval = 30
    private static let jsonLimit = 1024 * 1024
    private static let folderScope = "files.readwrite.appfolder"

    struct Tokens {
        let accessToken: String
        let refreshToken: String?
        let idToken: String?
        let scope: String
        let expiresInMs: Double
    }

    struct Claims: Equatable {
        let subject: String
        let hint: String?
    }

    static func networkFailure(_ error: Error, _ what: String) -> ICloudStoreError {
        if case OneDriveNetworkError.timeout = error {
            return ICloudStoreError(code: "timeout", message: "\(what) did not answer in time.")
        }
        return ICloudStoreError(code: "unavailable", message: "\(what) could not be reached.")
    }

    @MainActor
    static func redeem(
        _ transport: OneDriveTransport, clientId: String, now: Double, code: String, verifier: String
    ) async throws -> Tokens {
        try await request(transport, now: now, form: OneDriveRules.form([
            ("client_id", clientId), ("grant_type", "authorization_code"), ("code", code),
            ("redirect_uri", OneDriveAuthorization.redirectUri), ("code_verifier", verifier),
            ("scope", OneDriveAuthorization.scope),
        ]))
    }

    @MainActor
    static func refresh(_ transport: OneDriveTransport, clientId: String, now: Double, refreshToken: String) async throws -> Tokens {
        try await request(transport, now: now, form: OneDriveRules.form([
            ("client_id", clientId), ("grant_type", "refresh_token"), ("refresh_token", refreshToken),
            ("scope", OneDriveAuthorization.scope),
        ]))
    }

    @MainActor
    private static func request(_ transport: OneDriveTransport, now: Double, form: String) async throws -> Tokens {
        guard let url = URL(string: "\(OneDriveAuthorization.login)/token") else {
            throw ICloudStoreError(code: "failed", message: "Cloud backup stopped unexpectedly.")
        }
        let response: OneDriveResponse
        do {
            response = try await transport.send(OneDriveRequest(
                method: "POST", url: url, headers: ["Content-Type": "application/x-www-form-urlencoded"],
                body: Data(form.utf8), timeout: metadataSeconds, limit: jsonLimit
            ))
        } catch {
            throw networkFailure(error, "Microsoft sign-in")
        }
        let wait = OneDriveRules.retryAfterMs(response.header("retry-after"), now: now)
        let body = OneDriveRules.object(response.body)
        if response.ok {
            guard let access = body?["access_token"] as? String, !access.isEmpty else {
                throw ICloudStoreError(code: "invalid", message: "Microsoft answered the sign-in without an access token.")
            }
            let refresh = body?["refresh_token"] as? String
            let seconds: Double?
            if let text = body?["expires_in"] as? String {
                let trimmed = text.trimmingCharacters(in: .whitespaces)
                seconds = trimmed.isEmpty ? 0 : Double(trimmed)
            } else {
                seconds = OneDriveRules.number(body?["expires_in"])
            }
            let expires = seconds.map { $0.isFinite ? min(max($0, 60), 24 * 3600) * 1000 : 3_600_000 } ?? 3_600_000
            return Tokens(
                accessToken: access,
                refreshToken: (refresh?.isEmpty ?? true) ? nil : refresh,
                idToken: body?["id_token"] as? String,
                scope: body?["scope"] as? String ?? "",
                expiresInMs: expires
            )
        }
        if response.status == 429 || response.status == 503 || body?["error"] as? String == "temporarily_unavailable" {
            throw ICloudStoreError(code: "unavailable", message: "Microsoft sign-in asked to wait before trying again.", retryAfterMs: wait)
        }
        if response.status >= 500 {
            throw ICloudStoreError(code: "unavailable", message: "Microsoft sign-in did not answer this time.")
        }
        // invalid_grant, interaction_required and every other refusal: only a new sign-in can follow.
        throw ICloudStoreError(code: "refused", message: "Microsoft refused the sign-in.")
    }

    static func grantsAppFolder(_ scope: String) -> Bool {
        scope.lowercased().split(whereSeparator: { $0.isWhitespace }).contains { $0 == Substring(folderScope) }
    }

    // The id token comes straight from the token endpoint over TLS, which OpenID Connect accepts in place of
    // checking its signature (Core 1.0, section 3.1.3.7). Its audience, nonce and expiry are still checked,
    // so a token made for another app or another sign-in is never taken for this one.
    static func idTokenClaims(_ idToken: String?, clientId: String, nonce: String, now: Double) throws -> Claims {
        let invalid = ICloudStoreError(code: "invalid", message: "Microsoft did not confirm which account signed in.")
        let parts = (idToken ?? "").split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3,
              let payload = OneDriveRules.base64UrlDecode(String(parts[1])),
              let claims = OneDriveRules.object(payload) else { throw invalid }
        let audience: Bool
        if let list = claims["aud"] as? [Any] {
            audience = list.contains { ($0 as? String) == clientId }
        } else {
            audience = claims["aud"] as? String == clientId
        }
        guard let subject = OneDriveRules.displayText(claims["oid"]) ?? OneDriveRules.displayText(claims["sub"]),
              audience,
              claims["nonce"] as? String == nonce,
              let exp = OneDriveRules.number(claims["exp"]), exp.isFinite,
              exp * 1000 >= now - 5 * 60_000 else { throw invalid }
        let hint = OneDriveRules.displayText(claims["preferred_username"])
            ?? OneDriveRules.displayText(claims["email"])
            ?? OneDriveRules.displayText(claims["name"])
        return Claims(subject: subject, hint: hint)
    }
}
#endif
