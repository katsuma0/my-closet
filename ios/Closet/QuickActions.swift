import UIKit

/// Home-screen quick actions (long-press the app icon).
///
/// The items are static, declared in Info.plist (UIApplicationShortcutItems), so
/// they are there as soon as the app is installed, before its first launch. Each
/// item's type is the name the web app's window.closetAction(name) expects.
@MainActor
final class QuickActions {
    static let shared = QuickActions()

    // "stats" is the old name of "more", kept for a home screen that still shows the old item
    static let names: Set<String> = ["add", "look", "mix", "more", "stats"]

    /// An action that arrived before a web view could take it (a cold launch).
    private var pending: String?
    private var lastName: String?
    private var lastTime = Date.distantPast
    private var receivers: [WeakReceiver] = []

    private final class WeakReceiver {
        weak var value: WebView.Coordinator?
        init(_ value: WebView.Coordinator) { self.value = value }
    }

    func register(_ receiver: WebView.Coordinator) {
        receivers.removeAll { $0.value == nil }
        receivers.append(WeakReceiver(receiver))
    }

    /// Takes the action a new web view should open with, if any. Each one is taken once.
    func takePending() -> String? {
        defer { pending = nil }
        return pending
    }

    @discardableResult
    func receive(_ item: UIApplicationShortcutItem, in scene: UIScene?) -> Bool {
        let name = item.type
        guard Self.names.contains(name) else { return false }

        // At a cold launch the same item is reported twice (app delegate, then
        // scene delegate). Nobody can pick two quick actions within two seconds,
        // so a repeat that quick is the same one.
        if name == lastName, Date().timeIntervalSince(lastTime) < 2 { return true }
        lastName = name
        lastTime = Date()

        let live = receivers.compactMap(\.value)
        // The web view in that scene; or one still being put on screen (no window yet).
        if let receiver = live.first(where: { scene != nil && $0.scene === scene })
            ?? live.first(where: { $0.scene == nil }) {
            receiver.run(name)
        } else {
            pending = name
        }
        return true
    }
}
