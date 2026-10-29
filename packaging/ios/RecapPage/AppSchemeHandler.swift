import WebKit

/// Answers every request for the app's own scheme from the bundled files. WebKit will not route http
/// or https to an app, which is why the app's pages live at an origin of their own.
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    private let responder: AssetResponder

    init(assets: AppAssets) {
        responder = AssetResponder(assets: assets)
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let request = urlSchemeTask.request
        let reply = responder.reply(to: request.url, method: request.httpMethod)
        guard let url = request.url,
              let response = HTTPURLResponse(
                url: url, statusCode: reply.statusCode, httpVersion: "HTTP/1.1", headerFields: reply.headers)
        else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(reply.body)
        urlSchemeTask.didFinish()
    }

    // Every request is answered inside start, so there is never one left to stop.
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
