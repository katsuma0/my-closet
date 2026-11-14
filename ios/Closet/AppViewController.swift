import UIKit
import WebKit

/// The app's one screen: the web app full screen, with a native iOS tab bar whose middle is a round +
/// (Closet, Mix, +, Looks, More). The page scrolls behind them, as in any iOS app.
///
/// The contract with the page (js/app.js):
/// - The page posts {type: 'state', tab: 'closet' | 'mix' | 'looks' | 'more', bar: true | false}
///   to the "chrome" message handler on load and whenever its page, a sheet or a menu changes.
///   bar false means something covers the page (a sheet, an editor, a menu): the bar and the + step aside.
/// - A tab tap calls window.closetAction(tab). A tap on the + calls closetAction('create') (the page's big Create
///   sheet); held down, the + shows a quick menu that calls closetAction('add' | 'look' | 'surprise').
/// - The page keeps its content clear of the bar using the CSS variable --native-bar (the bar's height
///   plus the bottom safe area, in CSS px, which are points here) and the class "native-bar" on <html>.
/// - This side also watches <html data-theme> with its own script and posts {type: 'theme'}, so the bar,
///   the menus and the status bar follow the theme chosen in the app, not only the iPhone's setting.
@MainActor
final class AppViewController: UIViewController, UITabBarDelegate, WKScriptMessageHandler {
    let webView: WKWebView

    /// Runs once, at the first layout in a window. The page starts loading then, so even its first
    /// paint knows --native-bar (it is in the document-start script).
    var onReady: (() -> Void)?

    /// The tabs: the page's tab name, which is also the closetAction that opens it. A tab bar item's tag is
    /// its index here. The bar shows them as Closet, Mix, (the +), Looks, More.
    private static let tabNames = ["closet", "mix", "looks", "more"]
    /// The tag of the empty, disabled item in the middle of the bar that the + sits on.
    private static let plusSlotTag = 99

    private let contentController: WKUserContentController
    private let chrome = PassThroughView()        // the tab bar and the +, shown and hidden together
    private let tabBar = UITabBar()
    private let plusButton = UIButton(type: .system)
    private var hairlineHeight: NSLayoutConstraint?   // one pixel, set once the screen scale is known

    private var shownTab = "closet"   // the page's tab, as the page last reported it
    private var barVisible = true
    private var barHeight = 0         // what --native-bar says, in points
    private var pageLoaded = false
    private var started = false

    /// The iOS 26 design (Liquid Glass) is on: built with the iOS 26 SDK (Xcode 26 has Swift 6.2)
    /// and running on iOS 26 or later. Otherwise iOS draws the classic bars.
    private static var liquidGlass: Bool {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) { return true }
        #endif
        return false
    }

    init(configuration: WKWebViewConfiguration) {
        let controller = configuration.userContentController
        // The content controller keeps its message handlers alive, and this controller keeps the web
        // view (and so the content controller) alive: a weak link in between avoids a retain cycle.
        let relay = WeakMessageRelay()
        controller.add(relay, name: "chrome")
        AppViewController.installScripts(in: controller, barHeight: 0)   // not Self: no self before super.init
        contentController = controller
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init(nibName: nil, bundle: nil)
        relay.receiver = self
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // MARK: Layout

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .closetPaper
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        buildBar()
        if !AppOrigin.hasWebFiles {   // the error page has no tabs to switch
            barVisible = false
            chrome.isHidden = true
        }
    }

    private func buildBar() {
        let glass = Self.liquidGlass
        chrome.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(chrome)

        tabBar.translatesAutoresizingMaskIntoConstraints = false
        tabBar.delegate = self
        // The middle item holds the place of the +, which is drawn over it: never selected, never read out.
        let plusSlot = UITabBarItem(title: nil, image: nil, tag: Self.plusSlotTag)
        plusSlot.isEnabled = false
        plusSlot.isAccessibilityElement = false
        tabBar.items = [
            UITabBarItem(title: "Closet", image: UIImage(systemName: "hanger") ?? UIImage(systemName: "tshirt"), tag: 0), // hanger: iOS 17+
            UITabBarItem(title: "Mix", image: UIImage(systemName: "arrow.left.arrow.right"), tag: 1),
            plusSlot,
            UITabBarItem(title: "Looks", image: UIImage(systemName: "square.grid.2x2"), tag: 2),
            UITabBarItem(tabBarSystemItem: .more, tag: 3),   // the system's own "More", localized
        ]
        tabBar.selectedItem = tabBar.items?.first

        plusButton.translatesAutoresizingMaskIntoConstraints = false
        plusButton.configuration = Self.plusConfiguration()
        plusButton.menu = makeMenu()
        plusButton.showsMenuAsPrimaryAction = false  // a tap opens the page's Create sheet; a long press, the menu
        plusButton.addAction(UIAction { [weak self] _ in self?.callAction("create") }, for: .primaryActionTriggered)
        plusButton.isPointerInteractionEnabled = true
        plusButton.accessibilityLabel = "Add"
        plusButton.accessibilityHint = "Add clothes or make a look. Touch and hold for a quick menu."

        if !glass {
            // Classic bars: one strip of the system's own bar material and hairline under both the
            // tabs and the +, so they read as a single bar. (In iOS 26 the bar is glass and floats.)
            let system = UITabBarAppearance()
            system.configureWithDefaultBackground()
            let backdrop = UIVisualEffectView(effect: system.backgroundEffect)
            let hairline = UIView()
            hairline.backgroundColor = system.shadowColor ?? .separator
            for v in [backdrop, hairline] {
                v.translatesAutoresizingMaskIntoConstraints = false
                chrome.addSubview(v)
            }
            let pixel = hairline.heightAnchor.constraint(equalToConstant: 0.5)
            hairlineHeight = pixel
            NSLayoutConstraint.activate([
                pixel,
                backdrop.topAnchor.constraint(equalTo: chrome.topAnchor),
                backdrop.bottomAnchor.constraint(equalTo: chrome.bottomAnchor),
                backdrop.leadingAnchor.constraint(equalTo: chrome.leadingAnchor),
                backdrop.trailingAnchor.constraint(equalTo: chrome.trailingAnchor),
                hairline.topAnchor.constraint(equalTo: chrome.topAnchor),
                hairline.leadingAnchor.constraint(equalTo: chrome.leadingAnchor),
                hairline.trailingAnchor.constraint(equalTo: chrome.trailingAnchor),
            ])
            let clear = UITabBarAppearance()
            clear.configureWithTransparentBackground()
            tabBar.standardAppearance = clear
            tabBar.scrollEdgeAppearance = clear
        }
        chrome.addSubview(tabBar)
        chrome.addSubview(plusButton)

        // The bar takes the full width on iPhone, at most 560 points, centred, on iPad.
        let row = UILayoutGuide()
        chrome.addLayoutGuide(row)
        let rowFullWidth = row.widthAnchor.constraint(equalTo: chrome.widthAnchor)
        rowFullWidth.priority = .defaultHigh
        // The chrome starts at the top of the bar, or of the + if that reaches higher, so all of it can be
        // tapped. A low priority, below the bar's own hugging, so it never stretches the bar instead.
        let chromeTop = chrome.topAnchor.constraint(equalTo: tabBar.topAnchor)
        chromeTop.priority = UILayoutPriority(100)

        // The + sits on the bar's middle item: a round sage glass button on iOS 26, plus.circle.fill before.
        // The items share the bar's width equally, so the middle one is at the bar's centre. The size was
        // chosen without a device: check it sits well inside the iOS 26 glass capsule.
        let plusSize = glass ? CGSize(width: 50, height: 50) : CGSize(width: 56, height: 48)

        NSLayoutConstraint.activate([
            chrome.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            chrome.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            chrome.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            chromeTop,
            chrome.topAnchor.constraint(lessThanOrEqualTo: tabBar.topAnchor),
            chrome.topAnchor.constraint(lessThanOrEqualTo: plusButton.topAnchor),

            row.topAnchor.constraint(equalTo: chrome.topAnchor),
            row.bottomAnchor.constraint(equalTo: chrome.bottomAnchor),
            row.centerXAnchor.constraint(equalTo: chrome.centerXAnchor),
            row.widthAnchor.constraint(lessThanOrEqualToConstant: 560),
            rowFullWidth,

            // Pinned to the bottom of the screen (not of the safe area), the tab bar sizes itself to
            // cover the home indicator area too.
            tabBar.bottomAnchor.constraint(equalTo: chrome.bottomAnchor),
            tabBar.leadingAnchor.constraint(equalTo: row.leadingAnchor),
            tabBar.trailingAnchor.constraint(equalTo: row.trailingAnchor),
            // A safety net: never less than the classic 49 points above the home indicator.
            tabBar.topAnchor.constraint(lessThanOrEqualTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -49),

            plusButton.centerXAnchor.constraint(equalTo: tabBar.centerXAnchor),
            // Centred on the part of the bar above the home indicator, where the tabs are.
            plusButton.centerYAnchor.constraint(equalTo: tabBar.safeAreaLayoutGuide.centerYAnchor),
            plusButton.widthAnchor.constraint(equalToConstant: plusSize.width),
            plusButton.heightAnchor.constraint(equalToConstant: plusSize.height),
        ])

        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            // The soft edge effect under the floating bar: UITabBarController sets it up for the
            // scroll views it holds; a standalone bar asks for it with this interaction.
            let edge = UIScrollEdgeElementContainerInteraction()
            edge.scrollView = webView.scrollView
            edge.edge = .bottom
            chrome.addInteraction(edge)
        }
        #endif
    }

    private static func plusConfiguration() -> UIButton.Configuration {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            var config = UIButton.Configuration.prominentGlass()   // glass tinted with the app's sage accent
            config.image = UIImage(systemName: "plus", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20, weight: .semibold))
            return config
        }
        #endif
        var config = UIButton.Configuration.plain()
        config.image = UIImage(systemName: "plus.circle.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 30, weight: .regular))
        config.contentInsets = .zero
        return config
    }

    private func makeMenu() -> UIMenu {
        // The menu puts its first item nearest the finger, as iOS does for menus opened from the bottom.
        UIMenu(children: [
            UIAction(title: "Add clothes", image: UIImage(systemName: "tshirt")) { [weak self] _ in self?.callAction("add") },
            UIAction(title: "Create a look", image: UIImage(systemName: "square.grid.2x2")) { [weak self] _ in self?.callAction("look") },
            UIAction(title: "Surprise me", image: UIImage(systemName: "sparkles")) { [weak self] _ in self?.callAction("surprise") },
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let pixel = 1 / max(1, traitCollection.displayScale)
        if let hairline = hairlineHeight, hairline.constant != pixel { hairline.constant = pixel }
        chrome.layoutIfNeeded()
        let height = Int(chrome.bounds.height.rounded(.up))
        if height > 0, height != barHeight {   // first layout, rotation, size change
            barHeight = height
            Self.installScripts(in: contentController, barHeight: height)   // for the next page load
            if pageLoaded { webView.evaluateJavaScript(Self.barScript(height), completionHandler: nil) }
        }
        if barHeight > 0, view.window != nil { startOnce() }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        startOnce()   // in case no layout ever measured the bar: never leave the page unloaded
    }

    private func startOnce() {
        guard !started else { return }
        started = true
        let ready = onReady
        onReady = nil
        ready?()
    }

    // MARK: The page

    /// Called by the navigation delegate when a page has loaded.
    func pageDidLoad() {
        pageLoaded = true
        webView.evaluateJavaScript(Self.barScript(barHeight), completionHandler: nil)
    }

    /// Called when the page is about to be loaded again (its process ended): back to the start state.
    func pageWillReload() {
        pageLoaded = false
        shownTab = "closet"
        select("closet")
        setBarVisible(AppOrigin.hasWebFiles, animated: false)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "state":
            if let tab = body["tab"] as? String, Self.tabNames.contains(tab) {
                shownTab = tab
                select(tab)
            }
            if let bar = body["bar"] as? Bool { setBarVisible(bar, animated: true) }
        case "theme":
            // The theme chosen in the app's settings. "system" follows the iPhone's setting.
            let theme = body["theme"] as? String
            view.window?.overrideUserInterfaceStyle = theme == "dark" ? .dark : theme == "light" ? .light : .unspecified
        default:
            break
        }
    }

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        guard Self.tabNames.indices.contains(item.tag) else { return }
        let name = Self.tabNames[item.tag]
        if name == shownTab {
            // Tapping the tab you are on scrolls back to the top, as everywhere in iOS.
            let scroll = webView.scrollView
            scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: -scroll.adjustedContentInset.top), animated: true)
        }
        webView.evaluateJavaScript(Self.actionScript(name)) { [weak self] result, _ in
            // The page said no (something is open on it, or it is still loading): show its tab again.
            guard let self, (result as? Bool) != true else { return }
            self.select(self.shownTab)
        }
    }

    private func callAction(_ name: String) {
        webView.evaluateJavaScript(Self.actionScript(name), completionHandler: nil)
    }

    /// window.closetAction(name), as a script that always gives a Boolean: what closetAction returned,
    /// or false while it is not defined yet. `name` is always one of this file's own constants.
    private static func actionScript(_ name: String) -> String {
        "typeof window.closetAction === 'function' && window.closetAction('\(name)') === true"
    }

    private func select(_ name: String) {
        // by tag: the + slot in the middle means a tab's place in the bar is not its index in tabNames
        guard let index = Self.tabNames.firstIndex(of: name), let item = tabBar.items?.first(where: { $0.tag == index }),
              tabBar.selectedItem !== item else { return }
        tabBar.selectedItem = item   // no delegate call, so no closetAction
    }

    // MARK: Showing and hiding the bar

    private func setBarVisible(_ visible: Bool, animated: Bool) {
        guard visible != barVisible else { return }
        barVisible = visible
        chrome.isUserInteractionEnabled = visible
        chrome.accessibilityElementsHidden = !visible

        if animated, view.window != nil, UIAccessibility.isReduceMotionEnabled {
            // Reduce Motion: a quick cross-fade in place instead of a slide.
            chrome.transform = .identity
            chrome.isHidden = false
            UIView.transition(with: chrome, duration: 0.25, options: [.transitionCrossDissolve, .beginFromCurrentState]) {
                self.chrome.subviews.forEach { $0.isHidden = !visible }
            }
            return
        }

        chrome.subviews.forEach { $0.isHidden = false }
        if visible { chrome.isHidden = false }
        let offscreen = CGAffineTransform(translationX: 0, y: chrome.bounds.height + 30)
        let move = { self.chrome.transform = visible ? .identity : offscreen }
        // Hidden views are skipped by VoiceOver and by touches. A later show may already have begun; and a show
        // cut short by a hide reports finished = false at once, so only a slide that really ended hides the bar.
        let finish: (Bool) -> Void = { finished in if finished, !self.barVisible { self.chrome.isHidden = true } }
        guard animated, view.window != nil else {
            move()
            finish(true)
            return
        }
        // Away: a quick glide down. Back: a spring with a little bounce, so the bar lands rather than appears.
        UIView.animate(withDuration: visible ? 0.55 : 0.3, delay: 0,
                       usingSpringWithDamping: visible ? 0.78 : 1, initialSpringVelocity: 0,
                       options: [.beginFromCurrentState, .allowUserInteraction],
                       animations: move, completion: finish)
    }

    // MARK: Scripts

    /// Marks the page as inside the app and tells it the room to keep free at the bottom. WebKit runs
    /// document-start scripts once <html> exists; the fallback waits for it all the same.
    private static func barScript(_ height: Int) -> String {
        var js = "var r = document.documentElement; r.classList.add('native-bar');"
        if height > 0 { js += " r.style.setProperty('--native-bar', '\(height)px');" }
        return "(function () { function go() { \(js) } if (document.documentElement) go(); else document.addEventListener('readystatechange', go, { once: true }); })();"
    }

    /// Reports the theme chosen in the app (<html data-theme="light|dark">, none = follow the iPhone).
    private static let themeWatcher = """
    (function () {
      var last = null;
      function send() {
        var root = document.documentElement;
        if (!root) return;
        var theme = root.getAttribute('data-theme') || 'system';
        if (theme === last) return;
        last = theme;
        try { window.webkit.messageHandlers.chrome.postMessage({ type: 'theme', theme: theme }); } catch (e) {}
      }
      // Watches the document, which always exists, so it also sees <html> get its theme while parsing.
      new MutationObserver(send).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-theme'] });
      document.addEventListener('DOMContentLoaded', send);
    })();
    """

    /// Both run at document start, before the page's own scripts, so there is no flash of the web tab bar.
    private static func installScripts(in controller: WKUserContentController, barHeight: Int) {
        controller.removeAllUserScripts()
        for source in [barScript(barHeight), themeWatcher] {
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
    }
}

/// A container that takes no touches itself: a tap between or around the bars it holds (the page shows
/// through there in iOS 26) reaches the page underneath.
final class PassThroughView: UIView {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit === self ? nil : hit
    }
}

/// Passes script messages on to a receiver it does not keep alive.
@MainActor
final class WeakMessageRelay: NSObject, WKScriptMessageHandler {
    weak var receiver: WKScriptMessageHandler?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        receiver?.userContentController(userContentController, didReceive: message)
    }
}
