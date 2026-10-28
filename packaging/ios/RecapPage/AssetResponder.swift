import Foundation

/// The answer to one request for a bundled file.
struct AssetReply: Equatable {
    let statusCode: Int
    let headers: [String: String]
    let body: Data
}

/// Serves the bundled web app from its manifest, with the headers the Windows server sends, so the
/// pages run under the same content security policy on every platform.
struct AssetResponder {
    let assets: AppAssets
    let policy: NavigationPolicy

    init(assets: AppAssets) {
        self.assets = assets
        policy = NavigationPolicy(config: assets.config)
    }

    func reply(to url: URL?, method: String?) -> AssetReply {
        guard let url, policy.isLocal(url) else { return failure(403, "Blocked") }
        guard let path = policy.assetPath(url) else { return failure(403, "Forbidden") }
        guard (method ?? "GET").uppercased() == "GET" else { return failure(405, "Method Not Allowed") }
        if "/" + path == assets.config.health.path {
            return AssetReply(statusCode: 204, headers: headers(assets.config.health.headers), body: Data())
        }
        guard assets.paths.contains(path),
              let body = try? Data(contentsOf: assets.root.appendingPathComponent(path), options: .mappedIfSafe)
        else {
            return failure(404, "Not Found")
        }
        return AssetReply(statusCode: 200, headers: headers(["Content-Type": MimeType.of(path)]), body: body)
    }

    private func headers(_ extra: [String: String]) -> [String: String] {
        var result = assets.config.securityHeaders
        result["Cache-Control"] = "no-store"
        for (name, value) in extra { result[name] = value }
        return result
    }

    private func failure(_ status: Int, _ reason: String) -> AssetReply {
        AssetReply(statusCode: status, headers: headers(["Content-Type": "text/plain; charset=utf-8"]), body: Data(reason.utf8))
    }
}

/// The type each bundled file is served as. Module scripts must arrive as JavaScript or WebKit refuses
/// to run them.
enum MimeType {
    static func of(_ path: String) -> String {
        switch (path as NSString).pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "webmanifest": return "application/manifest+json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "ico": return "image/x-icon"
        case "md": return "text/markdown; charset=utf-8"
        default: return "application/octet-stream"
        }
    }
}
