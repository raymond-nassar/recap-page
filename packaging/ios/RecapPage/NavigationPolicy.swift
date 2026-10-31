import Foundation

/// Which navigations the app's web view may make, as rules with no web view in them, so they can be
/// tested on their own the way the Android app's NavigationPolicy is.
struct NavigationPolicy {
    enum Decision: Equatable {
        case allow
        case openExternally
        case refuse
    }

    let scheme: String
    let host: String

    init(scheme: String, host: String) {
        self.scheme = scheme
        self.host = host
    }

    init(config: AppConfig) {
        self.init(scheme: config.scheme, host: config.host)
    }

    func isLocal(_ url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        return parts.scheme == scheme && parts.host == host && parts.port == nil
            && parts.user == nil && parts.password == nil
    }

    /// The bundled file a URL names, or nil for anything that is not a plain path at the app origin.
    /// Percent escapes, empty segments and dot segments are refused rather than interpreted.
    func assetPath(_ url: URL) -> String? {
        guard isLocal(url), let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let path = parts.percentEncodedPath
        if path.isEmpty || path == "/" { return "index.html" }
        guard path.count <= 2048, path.range(of: "^/[A-Za-z0-9_./-]+$", options: .regularExpression) != nil else {
            return nil
        }
        let relative = String(path.dropFirst())
        let segments = relative.split(separator: "/", omittingEmptySubsequences: false)
        guard !segments.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." }) else { return nil }
        return relative
    }

    func isAppPage(_ url: URL) -> Bool {
        guard assetPath(url) == "index.html", let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return false
        }
        return parts.percentEncodedQuery == nil
    }

    func isLauncherPage(_ url: URL) -> Bool {
        assetPath(url) == "open.html"
    }

    func isWebLink(_ url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        return parts.scheme == "https" && !(parts.host ?? "").isEmpty && parts.user == nil && parts.password == nil
    }

    /// A navigation in the app's main web view. Only the app page loads in it; a link the reader
    /// follows to the web leaves the app for the system, and everything else is refused.
    func decide(url: URL?, isMainFrame: Bool, opensNewWindow: Bool, userActivated: Bool) -> Decision {
        guard let url else { return .refuse }
        if opensNewWindow && isLauncherPage(url) { return .allow }
        if isMainFrame && !opensNewWindow && isAppPage(url) { return .allow }
        if userActivated && isWebLink(url) { return .openExternally }
        return .refuse
    }

    /// The child web view may display only the bundled launcher. Its validated HTTPS destination
    /// leaves the app rather than rendering a remote page in the sheet.
    func decideLauncher(url: URL?, isMainFrame: Bool, opensNewWindow: Bool) -> Decision {
        guard let url, isMainFrame else { return .refuse }
        if !opensNewWindow && isLauncherPage(url) { return .allow }
        if !opensNewWindow && isWebLink(url) { return .openExternally }
        return .refuse
    }
}
