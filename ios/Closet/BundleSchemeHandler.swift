import Foundation
import UniformTypeIdentifiers
import WebKit

/// Where the web app lives: closet://app/ maps to the "web" folder in the app bundle.
///
/// The scheme and host together are the page's origin, which is what localStorage
/// and IndexedDB are stored under. Never change them, or saved data seems to vanish.
enum AppOrigin {
    static let scheme = "closet"
    static let host = "app"

    /// Closet.app/web/. The "Copy web app" build phase fills it at every build, from
    /// the repo root, into $TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/web,
    /// which on iOS is the top of the app bundle, the folder resourceURL points at.
    static let webRoot: URL? = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true)

    static var hasWebFiles: Bool {
        guard let webRoot else { return false }
        return FileManager.default.fileExists(atPath: webRoot.appendingPathComponent("index.html").path)
    }

    /// closet://app/ or, for a quick action at launch, closet://app/#action=add
    static func startURL(action: String?) -> URL {
        let hash = action.map { "#action=\($0)" } ?? ""
        return URL(string: "\(scheme)://\(host)/\(hash)")!
    }

    static let missingWebFilesPage = """
    <!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
    <body style="font: 17px -apple-system, sans-serif; padding: 60px 24px; color: #333">
    <h3>The web app is not in this build.</h3>
    <p>The "Copy web app" build step did not put it in. In Xcode, open the Report
    navigator (Cmd-9), select the last build and look for "Copy web app". The
    <code>ios</code> folder must stay in the repo, next to <code>index.html</code>.</p>
    """
}

/// Serves files from the bundled "web" folder for closet:// requests.
///
/// A custom scheme gives the page a real, stable origin, so ES modules (same-origin
/// requests with a JavaScript MIME type), localStorage and IndexedDB all work, and the
/// data stays in the web view's persistent store across launches. loadFileURL would give
/// a file:// page, where module scripts and IndexedDB are not reliable.
@MainActor
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url, let root = AppOrigin.webRoot?.standardizedFileURL else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        var path = String(url.path.drop(while: { $0 == "/" }))   // url.path is already percent-decoded
        if path.isEmpty || path.hasSuffix("/") { path += "index.html" }
        let file = root.appendingPathComponent(path).standardizedFileURL

        // Only files inside web/ (no "../" way out), and only files that exist.
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            respond(task, url: url, status: 404, type: "text/plain", body: Data("Not found".utf8))
            return
        }
        respond(task, url: url, status: 200, type: Self.mimeType(of: file), body: data)
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
        // Every response is sent in full inside start(), so there is never anything to stop.
    }

    private func respond(_ task: any WKURLSchemeTask, url: URL, status: Int, type: String, body: Data) {
        let headers = [
            "Content-Type": type,
            "Content-Length": String(body.count),
            "Cache-Control": "no-cache",   // a new app build always serves its new files
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(URLError(.cannotParseResponse))
            return
        }
        task.didReceive(response)
        task.didReceive(body)
        task.didFinish()
    }

    private static func mimeType(of file: URL) -> String {
        switch file.pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"   // modules are refused without it
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json"
        case "webmanifest": return "application/manifest+json"
        case "svg": return "image/svg+xml"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        default: return UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        }
    }
}
