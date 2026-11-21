import UIKit
import Capacitor

// The app starts through a scene (SceneDelegate below, declared under
// UIApplicationSceneManifest in Info.plist). Apps built with the iOS 27 SDK
// must: one that still owns its window in the app delegate is stopped at launch
// with "UIScene life cycle is required for apps built with this SDK". So this
// class no longer has a window; the scene does. iOS still sends push
// registration here, and links go to the scene delegate instead.
@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    // Push notifications. iOS answers a registration request here, not in the
    // web view: Capacitor's push plugin only learns the device token (or the
    // failure) if these two are passed on to it. Without them the app's
    // `register()` never resolves and no token ever reaches the server.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    // The one scene configuration, named in Info.plist.
    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        return UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    }

}

/// The app's window. UIKit makes it from Main.storyboard (UISceneStoryboardFile in
/// Info.plist), whose first screen is MainViewController, the Capacitor bridge.
///
/// With scenes, iOS hands a link that opens the app to the scene, never to the
/// app delegate: a universal link (sign-in, password reset, invites, replays,
/// your-turn links) arrives as a user activity, a custom-scheme link as a URL.
/// Each is passed to Capacitor's ApplicationDelegateProxy, as the app delegate
/// used to do. That is what fires the App plugin's `appUrlOpen` while the app is
/// running and what `getLaunchUrl` returns after a link started it
/// (frontend/src/components/native/AppLinkHandler.tsx reads both).
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // A link that started the app arrives here, not in the two methods below.
        for activity in connectionOptions.userActivities {
            continueActivity(activity)
        }
        for context in connectionOptions.urlContexts {
            open(context)
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        continueActivity(userActivity)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            open(context)
        }
    }

    private func continueActivity(_ activity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
    }

    private func open(_ context: UIOpenURLContext) {
        var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
        if let source = context.options.sourceApplication {
            options[.sourceApplication] = source
        }
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: options)
    }
}
