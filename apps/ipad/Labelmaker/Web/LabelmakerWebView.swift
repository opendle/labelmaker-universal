import SwiftUI
import UIKit
import WebKit

struct LabelmakerWebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.isFraudulentWebsiteWarningEnabled = true
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        configuration.allowsInlineMediaPlayback = false
        configuration.setURLSchemeHandler(
            context.coordinator.webAppSchemeHandler,
            forURLScheme: BundledWebAppSchemeHandler.scheme
        )
        configuration.userContentController.addScriptMessageHandler(
            context.coordinator.bridge,
            contentWorld: .page,
            name: "labelmaker"
        )

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.hideInputAssistant()
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        context.coordinator.webView = webView
        context.coordinator.workspace.setPresentingViewController(webView.enclosingViewController)
        DispatchQueue.main.async {
            context.coordinator.workspace.setPresentingViewController(webView.enclosingViewController)
            webView.hideInputAssistant()
        }

        guard
            Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "WebApp") != nil,
            let indexURL = URL(string: "\(BundledWebAppSchemeHandler.scheme)://\(BundledWebAppSchemeHandler.host)/index.html")
        else {
            webView.loadHTMLString(Self.missingBundlePage, baseURL: nil)
            return webView
        }
        webView.load(URLRequest(url: indexURL))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.workspace.setPresentingViewController(webView.enclosingViewController)
        webView.hideInputAssistant()
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "labelmaker", contentWorld: .page)
        coordinator.webView = nil
    }

    private static let missingBundlePage = """
    <!doctype html><meta name="viewport" content="width=device-width"><style>body{font:17px -apple-system;padding:40px;color:#333}</style><h1>Labelmaker could not start</h1><p>The shared web application is missing. Run <code>npm run build:web --workspace @labelmaker/ipad</code>, then build the Apple mobile target again.</p>
    """

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let workspace = WorkspaceCoordinator()
        let recovery = RecoveryStore()
        let webAppSchemeHandler = BundledWebAppSchemeHandler()
        let bluetooth: BluetoothTransportHandling
        lazy var bridge = NativeBridge(workspace: workspace, recovery: recovery, bluetooth: bluetooth)
        weak var webView: WKWebView?

        override init() {
            bluetooth = MakeIDBluetoothTransport()
            super.init()
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            if
                (url.scheme == BundledWebAppSchemeHandler.scheme && url.host == BundledWebAppSchemeHandler.host)
                || url.scheme == "about"
                || url.scheme == "blob"
                || url.scheme == "data"
            {
                decisionHandler(.allow)
            } else {
                decisionHandler(.cancel)
            }
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.hideInputAssistant()
        }
    }
}

private extension UIView {
    func hideInputAssistant() {
        inputAssistantItem.leadingBarButtonGroups = []
        inputAssistantItem.trailingBarButtonGroups = []
        subviews.forEach { $0.hideInputAssistant() }
    }

    var enclosingViewController: UIViewController? {
        sequence(first: next, next: { $0?.next }).first { $0 is UIViewController } as? UIViewController
    }
}
