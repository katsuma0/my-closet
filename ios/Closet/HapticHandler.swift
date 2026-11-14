import UIKit
import WebKit

/// Plays real iOS haptics for window.webkit.messageHandlers.haptic.postMessage(kind).
/// The system's Sounds & Haptics setting still applies.
@MainActor
final class HapticHandler: NSObject, WKScriptMessageHandler {
    private let light = UIImpactFeedbackGenerator(style: .light)
    private let medium = UIImpactFeedbackGenerator(style: .medium)
    private let heavy = UIImpactFeedbackGenerator(style: .heavy)
    private let selection = UISelectionFeedbackGenerator()
    private let notification = UINotificationFeedbackGenerator()

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let kind = message.body as? String else { return }
        // After each one, prepare() keeps that generator warm for the next few
        // seconds, so a quick run of taps plays with less delay.
        switch kind {
        case "light":
            light.impactOccurred(); light.prepare()
        case "select":
            selection.selectionChanged(); selection.prepare()
        case "medium", "long":   // "long": a long press has opened a menu
            medium.impactOccurred(); medium.prepare()
        case "heavy":
            heavy.impactOccurred(); heavy.prepare()
        case "success":
            notification.notificationOccurred(.success); notification.prepare()
        case "warning":
            notification.notificationOccurred(.warning); notification.prepare()
        default:
            break
        }
    }
}
