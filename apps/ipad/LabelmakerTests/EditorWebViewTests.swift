import UIKit
import WebKit
import XCTest
@testable import Labelmaker

@MainActor
final class EditorWebViewTests: XCTestCase {
    func testEditorPointerPrecedesTheWebPointerAndPreservesItOnDetach() throws {
        let webView = EditorWebView(frame: .zero, configuration: WKWebViewConfiguration())
        let surface = try XCTUnwrap(webView.scrollView.subviews.first(where: { !($0 is UIImageView) }))
        let original = UIPointerInteraction(delegate: nil)
        surface.addInteraction(original)
        let pointer = EditorPointer()
        pointer.attach(to: webView)
        let interactions = surface.interactions.compactMap { $0 as? UIPointerInteraction }
        XCTAssertTrue(interactions.first?.delegate === pointer)
        XCTAssertTrue(interactions.contains(where: { $0 === original }))
        pointer.detach()
        XCTAssertTrue(surface.interactions.contains(where: { $0 === original }))
        XCTAssertFalse(surface.interactions.contains(where: { ($0 as? UIPointerInteraction)?.delegate === pointer }))
    }

    func testEditorShortcutsHavePriorityOverSystemCommands() {
        let webView = EditorWebView(frame: .zero, configuration: WKWebViewConfiguration())
        for (key, flags) in [("z", UIKeyModifierFlags.command), ("z", [.command, .shift]), ("s", .command), ("+", .command)] {
            let command = webView.keyCommands?.first { $0.input == key && $0.modifierFlags == flags }
            XCTAssertEqual(command?.wantsPriorityOverSystemBehavior, true)
        }
    }

    func testCommandReachesTheFocusedWebFieldOnce() async throws {
        let webView = EditorWebView(frame: CGRect(x: 0, y: 0, width: 600, height: 400), configuration: WKWebViewConfiguration())
        let loaded = expectation(description: "The editor page loaded")
        let navigation = EditorTestNavigation(loaded: loaded)
        webView.navigationDelegate = navigation
        webView.loadHTMLString("<input id='field'><script>window.keys=[];window.addEventListener('keydown',e=>keys.push({key:e.key,meta:e.metaKey,shift:e.shiftKey,target:e.target.id}));</script>", baseURL: nil)
        await fulfillment(of: [loaded], timeout: 10)
        _ = try await webView.evaluateJavaScript("document.getElementById('field').focus()")
        let command = try XCTUnwrap(webView.keyCommands?.first { $0.input == "z" && $0.modifierFlags == [.command, .shift] })
        webView.editorCommand(command)
        let keys = try await webView.callAsyncJavaScript("return keys", arguments: [:], in: nil, contentWorld: .page) as? [[String: Any]]
        XCTAssertEqual(keys?.count, 1)
        XCTAssertEqual(keys?.first?["key"] as? String, "z")
        XCTAssertEqual(keys?.first?["meta"] as? Bool, true)
        XCTAssertEqual(keys?.first?["shift"] as? Bool, true)
        XCTAssertEqual(keys?.first?["target"] as? String, "field")
    }
}

@MainActor
private final class EditorTestNavigation: NSObject, WKNavigationDelegate {
    let loaded: XCTestExpectation
    init(loaded: XCTestExpectation) { self.loaded = loaded }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loaded.fulfill() }
}
