import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = Self.rootViewController()
        window.makeKeyAndVisible()
        self.window = window
    }

    private static func rootViewController() -> UIViewController {
        #if DEBUG
        // While the app hosts the unit tests its own screen stays empty, so the only pages running are
        // the ones the tests build and examine.
        if DebugSupport.isHostingUnitTests {
            let placeholder = UIViewController()
            placeholder.view.backgroundColor = .recapPageBackground
            return placeholder
        }
        #endif
        return WebViewController()
    }
}
