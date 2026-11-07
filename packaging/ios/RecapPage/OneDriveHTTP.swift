#if RECAP_ICLOUD || DEBUG
import Foundation

/// One HTTPS request to Microsoft, as the Android app's CloudHttp makes it: a whole body, a time limit and
/// a cap on how much of the answer is kept.
struct OneDriveRequest {
    var method: String
    var url: URL
    var headers: [String: String] = [:]
    var body: Data?
    var timeout: TimeInterval
    var limit: Int
}

struct OneDriveResponse {
    let status: Int
    /// Header names in lower case.
    let headers: [String: String]
    /// Nil when the answer was larger than the request's cap.
    let body: Data?

    var ok: Bool { (200..<300).contains(status) }
    var tooLarge: Bool { body == nil }

    func header(_ name: String) -> String? { headers[name.lowercased()] }
}

enum OneDriveNetworkError: Error {
    case timeout
    case unreachable
}

@MainActor
protocol OneDriveTransport: AnyObject {
    func send(_ request: OneDriveRequest) async throws -> OneDriveResponse
}

/// Redirects are answered as they are rather than followed, so a token can never travel to an address a
/// redirect chose; the only one expected, a download's, is checked and followed by the store itself.
private final class OneDriveNoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

/// An ephemeral session: no cookies, no cache and no credential storage, so nothing of an account is kept
/// on the device except the Keychain record the account keeps on purpose.
@MainActor
final class OneDriveURLSessionTransport: OneDriveTransport {
    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.urlCredentialStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: configuration, delegate: OneDriveNoRedirects(), delegateQueue: nil)
    }

    func send(_ request: OneDriveRequest) async throws -> OneDriveResponse {
        var urlRequest = URLRequest(url: request.url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: request.timeout)
        urlRequest.httpMethod = request.method
        for (name, value) in request.headers {
            urlRequest.setValue(value, forHTTPHeaderField: name)
        }
        urlRequest.httpBody = request.body
        let result: (Data, URLResponse)
        do {
            result = try await session.data(for: urlRequest)
        } catch let error as URLError where error.code == .timedOut {
            throw OneDriveNetworkError.timeout
        } catch {
            throw OneDriveNetworkError.unreachable
        }
        guard let http = result.1 as? HTTPURLResponse else { throw OneDriveNetworkError.unreachable }
        var headers: [String: String] = [:]
        for (key, value) in http.allHeaderFields {
            if let key = key as? String, let value = value as? String {
                headers[key.lowercased()] = value
            }
        }
        return OneDriveResponse(
            status: http.statusCode,
            headers: headers,
            body: result.0.count <= request.limit ? result.0 : nil
        )
    }
}

/// The rules the Android app's CloudRules and the Windows host apply, written once for the iOS OneDrive code.
enum OneDriveRules {
    static let maximumBytes = 32 * 1024 * 1024
    static let maximumWaitMs = 60 * 60 * 1000

    static func base64Url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func base64UrlDecode(_ text: String) -> Data? {
        guard text.range(of: "^[A-Za-z0-9_-]*$", options: .regularExpression) != nil else { return nil }
        var standard = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while standard.count % 4 != 0 { standard += "=" }
        return Data(base64Encoded: standard)
    }

    static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    private static func percentEncode(_ value: String, keeping extra: String) -> String {
        var out = ""
        for byte in Array(value.utf8) {
            let scalar = Unicode.Scalar(byte)
            let character = Character(scalar)
            if (byte >= 0x41 && byte <= 0x5A) || (byte >= 0x61 && byte <= 0x7A) || (byte >= 0x30 && byte <= 0x39)
                || extra.contains(character) {
                out.append(character)
            } else {
                out += String(format: "%%%02X", byte)
            }
        }
        return out
    }

    /// As URLSearchParams writes a value, except that a space is written %20, which a form body and a query
    /// both read as a space.
    static func form(_ pairs: [(String, String)]) -> String {
        pairs.map { "\(percentEncode($0.0, keeping: "*-._"))=\(percentEncode($0.1, keeping: "*-._"))" }
            .joined(separator: "&")
    }

    /// As encodeURIComponent writes a path segment.
    static func segment(_ value: String) -> String {
        percentEncode(value, keeping: "-_.!~*'()")
    }

    /// Percent-decoding, with + read as a space when asked, as a query is read. Nil for a malformed escape
    /// or bytes that are not UTF-8.
    static func decode(_ value: String, plusIsSpace: Bool) -> String? {
        var bytes: [UInt8] = []
        let source = Array(value.utf8)
        var index = 0
        while index < source.count {
            let byte = source[index]
            if byte == 0x25 {
                guard index + 2 < source.count,
                      let high = hexDigit(source[index + 1]),
                      let low = hexDigit(source[index + 2]) else { return nil }
                bytes.append(high * 16 + low)
                index += 3
                continue
            }
            bytes.append(byte == 0x2B && plusIsSpace ? 0x20 : byte)
            index += 1
        }
        return String(bytes: bytes, encoding: .utf8)
    }

    private static func hexDigit(_ byte: UInt8) -> UInt8? {
        switch byte {
        case 0x30...0x39: return byte - 0x30
        case 0x41...0x46: return byte - 0x41 + 10
        case 0x61...0x66: return byte - 0x61 + 10
        default: return nil
        }
    }

    static func constantTimeEqual(_ first: String, _ second: String) -> Bool {
        let a = Array(first.utf8)
        let b = Array(second.utf8)
        guard a.count == b.count else { return false }
        var difference: UInt8 = 0
        for index in 0..<a.count { difference |= a[index] ^ b[index] }
        return difference == 0
    }

    /// Text fit to show as an account: 1 to 256 characters, none of them a control character.
    static func displayText(_ value: Any?) -> String? {
        guard let text = value as? String, !text.isEmpty, text.utf16.count <= 256 else { return nil }
        for unit in text.utf16 where unit <= 0x1F || unit == 0x7F { return nil }
        return text
    }

    /// A number JSON carried, never a true or false read as one.
    static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        return number.doubleValue
    }

    static func safeInteger(_ value: Any?) -> Int? {
        guard let number = number(value), number.isFinite, number == number.rounded(),
              abs(number) <= 9_007_199_254_740_991 else { return nil }
        return Int(number)
    }

    /// A capability URL a provider handed back, an upload session or a download: https to an ordinary host
    /// name, never checked against a list of hosts. Nil when it is not one.
    static func capabilityUrl(_ value: Any?) -> URL? {
        guard let text = value as? String,
              let components = URLComponents(string: text),
              components.scheme?.lowercased() == "https",
              components.user == nil, components.password == nil,
              let host = components.host?.lowercased(),
              let url = components.url else { return nil }
        if let port = components.port, port != 443 { return nil }
        if !host.contains(".") || host.hasSuffix(".") || host.hasPrefix("[")
            || host.range(of: "^[0-9.]+$", options: .regularExpression) != nil
            || host == "localhost" || host.hasSuffix(".localhost") { return nil }
        return url
    }

    private static let httpDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "GMT")
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        return formatter
    }()

    /// Seconds or an HTTP date, as the providers send it, held to an hour.
    static func retryAfterMs(_ header: String?, now: Double) -> Int {
        let value = (header ?? "").trimmingCharacters(in: .whitespaces)
        guard !value.isEmpty else { return 0 }
        let wait: Double
        if value.range(of: "^[0-9]{1,7}$", options: .regularExpression) != nil, let seconds = Double(value) {
            wait = seconds * 1000
        } else if let date = httpDate.date(from: value) {
            wait = date.timeIntervalSince1970 * 1000 - now
        } else {
            return 0
        }
        return Int(min(max(0, wait), Double(maximumWaitMs)))
    }

    static func isItemId(_ value: Any?) -> Bool {
        guard let text = value as? String else { return false }
        return text.range(of: "^(?!\\.+$)[A-Za-z0-9!._-]{1,256}$", options: .regularExpression) != nil
    }

    static func isConnection(_ value: Any?) -> Bool {
        guard let text = value as? String else { return false }
        return text.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil
    }

    static func object(_ data: Data?) -> [String: Any]? {
        guard let data else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    static func random(_ count: Int) -> Data {
        var generator = SystemRandomNumberGenerator()
        return Data((0..<count).map { _ in UInt8.random(in: 0...255, using: &generator) })
    }
}
#endif
