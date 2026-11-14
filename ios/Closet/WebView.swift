import SwiftUI
import UIKit
import WebKit

/// The web app, full screen, served from the app bundle at closet://app/, under the native
/// tab bar of AppViewController.
struct WebView: UIViewControllerRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIViewController(context: Context) -> AppViewController {
        let configuration = WKWebViewConfiguration()
        // Default (persistent) website data store: localStorage and IndexedDB survive relaunches.
        configuration.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: AppOrigin.scheme)
        // The handler keeps no reference to the web view, so the strong reference the
        // user content controller holds on it cannot form a retain cycle.
        configuration.userContentController.add(HapticHandler(), name: "haptic")

        // Adds the "chrome" handler and its scripts, then makes the web view.
        let controller = AppViewController(configuration: configuration)
        let webView = controller.webView
        webView.allowsLinkPreview = false             // long press belongs to the page's own menus
        webView.isOpaque = false                      // no white flash before the first paint
        webView.backgroundColor = .closetPaper
        webView.scrollView.backgroundColor = .closetPaper
        webView.scrollView.contentInsetAdjustmentBehavior = .never  // the CSS pads with env(safe-area-inset-*)
        webView.scrollView.decelerationRate = .normal // the same momentum as native lists
        webView.navigationDelegate = context.coordinator
        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true              // Safari > Develop > (your iPhone) > Closet
        }
        #endif

        let coordinator = context.coordinator
        coordinator.chrome = controller
        // The page loads once the controller is on screen and knows the height of its bar.
        controller.onReady = { [weak controller] in
            guard let controller else { return }
            coordinator.start(controller.webView)
        }
        return controller
    }

    func updateUIViewController(_ controller: AppViewController, context: Context) {}
}

extension UIColor {
    /// The page background (--bg in css/style.css), shown until the page paints.
    static var closetPaper: UIColor {
        UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0x1b / 255.0, green: 0x19 / 255.0, blue: 0x17 / 255.0, alpha: 1)
                : UIColor(red: 0xf6 / 255.0, green: 0xf3 / 255.0, blue: 0xee / 255.0, alpha: 1)
        }
    }
}

extension WebView {
    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKDownloadDelegate {
        private weak var webView: WKWebView?
        /// The native tab bar's controller, told when a page has loaded or is loaded again.
        weak var chrome: AppViewController?
        private var loaded = false        // the first navigation has finished
        private var queued: String?       // a quick action waiting for that
        private var downloads: [WKDownload: URL] = [:]

        /// The scene this web view is shown in (nil until it is in a window).
        var scene: UIScene? { webView?.window?.windowScene }

        func start(_ webView: WKWebView) {
            self.webView = webView
            QuickActions.shared.register(self)
            guard AppOrigin.hasWebFiles else {
                webView.loadHTMLString(AppOrigin.missingWebFilesPage, baseURL: nil)
                return
            }
            // A quick action that launched the app rides in the URL hash (#action=add);
            // the page acts on it once it has loaded. Nothing else delivers that one.
            webView.load(URLRequest(url: AppOrigin.startURL(action: QuickActions.shared.takePending())))
        }

        /// A quick action while the app is running.
        func run(_ name: String) {
            guard loaded, let webView else {
                queued = name
                return
            }
            // `name` is one of QuickActions.names, so it is safe to put in the script.
            // The short retry only matters right after a load, before app.js has
            // defined closetAction; the call itself happens at most once.
            let script = """
            (function (name, tries) {
              (function go() {
                if (typeof window.closetAction === 'function') window.closetAction(name);
                else if (tries-- > 0) setTimeout(go, 100);
              })();
            })("\(name)", 30);
            """
            webView.evaluateJavaScript(script, completionHandler: nil)
        }

        // MARK: Navigation

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            loaded = true
            chrome?.pageDidLoad()
            if let name = queued {
                queued = nil
                run(name)
            }
        }

        /// iOS can end the web content process while the app is in the background.
        /// Load the plain start page again: reloading the current URL could repeat
        /// a quick action still sitting in its hash.
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            loaded = false
            chrome?.pageWillReload()
            webView.load(URLRequest(url: AppOrigin.startURL(action: nil)))
        }

        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            // <a download>: the JSON backup, or a look picture when sharing is not offered.
            if navigationAction.shouldPerformDownload { return .download }
            guard let url = navigationAction.request.url else { return .cancel }
            switch url.scheme?.lowercased() ?? "" {
            case AppOrigin.scheme, "about":
                return .allow
            case "blob", "data":
                // A file the page made. Never show it in place of the app.
                return .download
            default:
                // Web links, mailto: and the like open outside, so the app page stays.
                if navigationAction.targetFrame?.isMainFrame ?? true {
                    UIApplication.shared.open(url, options: [:], completionHandler: nil)
                }
                return .cancel
            }
        }

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
            download.delegate = self
        }

        // MARK: Downloads: hand the file to the share sheet (Save to Files, AirDrop, Mail...)

        /// Files from earlier launches are removed the first time this is used.
        private static let downloadsFolder: URL = {
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Downloads", isDirectory: true)
            try? FileManager.default.removeItem(at: folder)
            return folder
        }()

        func download(_ download: WKDownload,
                      decideDestinationUsing response: URLResponse,
                      suggestedFilename: String) async -> URL? {
            // A fresh folder per download keeps the page's file name (my-closet-2026-11-13.json)
            // and meets WebKit's rule that the destination must not exist yet.
            let folder = Self.downloadsFolder.appendingPathComponent(UUID().uuidString, isDirectory: true)
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            } catch {
                return nil
            }
            let name = (suggestedFilename as NSString).lastPathComponent
            let file = folder.appendingPathComponent(name.isEmpty ? "download" : name)
            downloads[download] = file
            return file
        }

        func downloadDidFinish(_ download: WKDownload) {
            guard let file = downloads.removeValue(forKey: download) else { return }
            share(file)
        }

        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            downloads.removeValue(forKey: download)
        }

        private func share(_ file: URL) {
            guard let webView, var presenter = webView.window?.rootViewController else { return }
            while let shown = presenter.presentedViewController { presenter = shown }
            let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            if let popover = sheet.popoverPresentationController {   // iPad
                popover.sourceView = webView
                popover.sourceRect = CGRect(x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1)
                popover.permittedArrowDirections = []
            }
            presenter.present(sheet, animated: true)
        }
    }
}
