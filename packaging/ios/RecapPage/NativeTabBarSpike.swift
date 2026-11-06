#if DEBUG
import UIKit
import WebKit

final class NativeTabBarSpike: NSObject, UITabBarDelegate {
    let tabBar = UITabBar()
    private weak var webView: WKWebView?
    private var height: NSLayoutConstraint?
    private let routes = ["#/home", "#/library", "#/add", "#/data"]

    override init() {
        super.init()
        let destinations = [
            ("Home", "house"),
            ("Library", "books.vertical"),
            ("Search", "magnifyingglass"),
            ("Settings", "gearshape"),
        ]
        let items = destinations.enumerated().map { index, destination in
            UITabBarItem(title: destination.0, image: UIImage(systemName: destination.1), tag: index)
        }
        tabBar.items = items
        tabBar.selectedItem = items.first
        tabBar.delegate = self
        tabBar.accessibilityIdentifier = "ios-native-spike-tabs"
    }

    func attach(to parent: UIView, webView: WKWebView) {
        self.webView = webView
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        parent.addSubview(tabBar)
        let height = tabBar.heightAnchor.constraint(equalToConstant: 49 + parent.safeAreaInsets.bottom)
        self.height = height
        NSLayoutConstraint.activate([
            tabBar.leadingAnchor.constraint(equalTo: parent.leadingAnchor),
            tabBar.trailingAnchor.constraint(equalTo: parent.trailingAnchor),
            tabBar.bottomAnchor.constraint(equalTo: parent.bottomAnchor),
            height,
        ])
    }

    func updateBottomInset(_ bottom: CGFloat) {
        height?.constant = 49 + bottom
    }

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        guard routes.indices.contains(item.tag), let webView else {
            NSLog("The native tab could not navigate because its route or web view was unavailable.")
            return
        }
        let route = routes[item.tag]
        webView.evaluateJavaScript("location.hash = '\(route)'") { _, error in
            if let error {
                NSLog("The native tab could not open %@: %@", route, error.localizedDescription)
            }
        }
    }
}
#endif
