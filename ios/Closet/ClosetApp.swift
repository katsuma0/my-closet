import SwiftUI
import UIKit

@main
struct ClosetApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

/// In a scene-based app (every SwiftUI app is one) UIKit never calls the app
/// delegate's quick-action method. The app delegate's only job here is to hand
/// SwiftUI a scene delegate, which is where quick actions arrive.
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        // A quick action that launches the app is also visible here, before the
        // window exists, so the web view can open straight on it.
        if let item = options.shortcutItem {
            QuickActions.shared.receive(item, in: nil)
        }
        let configuration = UISceneConfiguration(name: nil, sessionRole: connectingSceneSession.role)
        if connectingSceneSession.role == .windowApplication {
            configuration.delegateClass = SceneDelegate.self
        }
        return configuration
    }
}

/// SwiftUI creates this object and forwards the scene callbacks to it.
@MainActor
final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    /// The app was not running: the quick action comes with the new scene.
    func scene(_ scene: UIScene,
               willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        if let item = connectionOptions.shortcutItem {
            QuickActions.shared.receive(item, in: scene)
        }
    }

    /// The app was already running (usually in the background).
    func windowScene(_ windowScene: UIWindowScene,
                     performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        completionHandler(QuickActions.shared.receive(shortcutItem, in: windowScene))
    }
}
