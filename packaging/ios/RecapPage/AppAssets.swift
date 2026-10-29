import Foundation

/// The generated `ios-config.json`: the page origin, the headers every bundled file is served with,
/// and the health answer the shared app checks for.
struct AppConfig: Decodable, Equatable {
    struct Health: Decodable, Equatable {
        let path: String
        let headers: [String: String]
    }

    let version: String
    let origin: String
    let scheme: String
    let host: String
    let securityHeaders: [String: String]
    let health: Health
}

/// The generated `ios-assets.json`. Only the paths it lists are ever served.
struct AssetManifest: Decodable {
    struct Entry: Decodable {
        let path: String
    }

    let files: [Entry]
}

enum AppAssetsError: Error, Equatable {
    case missingBundle
    case unexpectedOrigin(String)
}

/// The bundled web app: where its files are, how they are served and which of them exist.
struct AppAssets {
    /// The page origin. It keys every saved byte of reading data, so like the Windows app's port it can
    /// never change once the app is installed, and a configuration naming any other origin is refused.
    static let permanentOrigin = "recappage://localhost"

    let root: URL
    let config: AppConfig
    let paths: Set<String>

    init(root: URL) throws {
        let decoder = JSONDecoder()
        let config = try decoder.decode(
            AppConfig.self, from: Data(contentsOf: root.appendingPathComponent("ios-config.json")))
        guard config.origin == Self.permanentOrigin, config.origin == "\(config.scheme)://\(config.host)" else {
            throw AppAssetsError.unexpectedOrigin(config.origin)
        }
        let manifest = try decoder.decode(
            AssetManifest.self, from: Data(contentsOf: root.appendingPathComponent("ios-assets.json")))
        self.root = root
        self.config = config
        paths = Set(manifest.files.map(\.path))
    }

    static func bundled(in bundle: Bundle = .main) throws -> AppAssets {
        guard let root = bundle.url(forResource: "web", withExtension: nil) else {
            throw AppAssetsError.missingBundle
        }
        return try AppAssets(root: root)
    }

    var appPageURL: URL {
        guard let url = URL(string: "\(config.scheme)://elsewhere/") else {
            preconditionFailure("The checked origin always forms a URL")
        }
        return url
    }
}
