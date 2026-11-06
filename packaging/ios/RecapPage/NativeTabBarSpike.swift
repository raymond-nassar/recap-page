#if DEBUG
import UIKit
import WebKit

@MainActor
final class NativeTabBarSpike: NSObject, UITabBarDelegate, WKScriptMessageHandler {
    private static let messageName = "recapNativeTabSpike"
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

    func registerMessageHandler(in controller: WKUserContentController) {
        controller.add(self, name: Self.messageName)
    }

    func installScripts(in controller: WKUserContentController) {
        controller.addUserScript(WKUserScript(
            source: Self.routeObserverScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        controller.addUserScript(WKUserScript(
            source: Self.narrowBarStyleScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Self.messageName, message.frameInfo.isMainFrame, let hash = message.body as? String else {
            NSLog("The native tab route observer received an invalid message.")
            return
        }
        guard let index = Self.tabIndex(for: hash) else { return }
        guard let items = tabBar.items, items.indices.contains(index) else {
            NSLog("The native tab route observer could not select its destination.")
            return
        }
        tabBar.selectedItem = items[index]
    }

    private static func tabIndex(for hash: String) -> Int? {
        guard hash.hasPrefix("#/"),
              let view = hash.dropFirst(2).split(whereSeparator: { $0 == "/" || $0 == "?" }).first else {
            return nil
        }
        switch view {
        case "home", "browse": return 0
        case "library", "read", "progress", "completed": return 1
        case "add": return 2
        case "data": return 3
        default:
            if view.hasPrefix("library-") { return 1 }
            if view.hasPrefix("add-") { return 2 }
            return nil
        }
    }

    private static let routeObserverScript = #"""
    (() => {
      let lastHash;
      const publish = () => {
        const hash = location.hash;
        if (hash === lastHash) return;
        try {
          window.webkit.messageHandlers.recapNativeTabSpike.postMessage(hash);
          lastHash = hash;
        } catch (error) {
          console.error('The native tab route could not be reported.', error);
        }
      };
      for (const method of ['pushState', 'replaceState']) {
        const original = history[method];
        history[method] = function(...args) {
          const result = original.apply(this, args);
          publish();
          return result;
        };
      }
      window.addEventListener('hashchange', publish);
      window.addEventListener('popstate', publish);
      publish();
    })();
    """#

    private static let narrowBarStyleScript = #"""
    (() => {
      const header = document.querySelector('.rail-header');
      if (!header) {
        console.error('The native tab bar could not find the web navigation.');
        return;
      }
      const root = document.documentElement;
      const narrow = matchMedia('(max-width: 880px)');
      let previousDisplay = null;
      let previousHeight = null;
      const save = (style, name) => ({
        value: style.getPropertyValue(name),
        priority: style.getPropertyPriority(name),
      });
      const restore = (style, name, previous) => {
        if (previous.value) style.setProperty(name, previous.value, previous.priority);
        else style.removeProperty(name);
      };
      const update = () => {
        if (narrow.matches) {
          if (previousDisplay === null) {
            previousDisplay = save(header.style, 'display');
            previousHeight = save(root.style, '--mobile-nav-height');
          }
          header.style.setProperty('display', 'none', 'important');
          root.style.setProperty('--mobile-nav-height', '0px');
        } else if (previousDisplay !== null) {
          restore(header.style, 'display', previousDisplay);
          restore(root.style, '--mobile-nav-height', previousHeight);
          previousDisplay = null;
          previousHeight = null;
        }
      };
      narrow.addEventListener('change', update);
      update();
    })();
    """#

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
