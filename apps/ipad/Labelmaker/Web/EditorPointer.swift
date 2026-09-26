import UIKit
import WebKit

@MainActor
final class EditorPointer: NSObject, WKScriptMessageHandler, UIPointerInteractionDelegate {
    private var interaction: UIPointerInteraction?
    private var cursor: String?
    private var bounds = CGRect.zero

    func attach(to webView: WKWebView) {
        detach()
        // Use the public view tree so the pointer and web content share a surface.
        let surface = webView.scrollView.subviews.first(where: { view in
            view.interactions.contains(where: { $0 is UIPointerInteraction })
        }) ?? webView.scrollView.subviews.first(where: { !($0 is UIImageView) }) ?? webView
        let existing = surface.interactions.filter { $0 is UIPointerInteraction }
        // Test editor handles before WebKit's default pointer region.
        for interaction in existing { surface.removeInteraction(interaction) }
        let interaction = UIPointerInteraction(delegate: self)
        surface.addInteraction(interaction)
        for interaction in existing { surface.addInteraction(interaction) }
        self.interaction = interaction
    }

    func detach() {
        if let interaction { interaction.view?.removeInteraction(interaction) }
        interaction = nil
        cursor = nil
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              BundledWebAppSchemeHandler.isAppFrame(message.frameInfo.request.url, isMainFrame: true),
              let body = message.body as? [String: Any] else { return }
        let next = body["cursor"] as? String ?? ""
        guard ["", "rotate", "ew-resize", "ns-resize", "nwse-resize", "nesw-resize"].contains(next) else { return }
        cursor = next.isEmpty ? nil : next
        if let x = body["x"] as? Double, let y = body["y"] as? Double,
           let width = body["width"] as? Double, let height = body["height"] as? Double,
           [x, y, width, height].allSatisfy({ $0.isFinite }), width > 0, height > 0 {
            bounds = CGRect(x: x, y: y, width: width, height: height)
        } else {
            cursor = nil
        }
        interaction?.invalidate()
    }

    func pointerInteraction(_ interaction: UIPointerInteraction, regionFor request: UIPointerRegionRequest, defaultRegion: UIPointerRegion) -> UIPointerRegion? {
        guard let cursor, bounds.contains(request.location) else { return nil }
        return UIPointerRegion(rect: bounds, identifier: cursor as NSString)
    }

    func pointerInteraction(_ interaction: UIPointerInteraction, styleFor region: UIPointerRegion) -> UIPointerStyle? {
        guard let cursor else { return nil }
        let path = UIBezierPath()
        if cursor == "rotate" {
            path.addArc(withCenter: .zero, radius: 8, startAngle: -.pi * 0.8, endAngle: .pi * 0.65, clockwise: true)
            path.addLine(to: CGPoint(x: -9, y: 3))
            path.move(to: CGPoint(x: -4, y: 7))
            path.addLine(to: CGPoint(x: -2, y: 12))
        } else {
            path.move(to: CGPoint(x: -11, y: 0))
            path.addLine(to: CGPoint(x: 11, y: 0))
            for sign: CGFloat in [-1, 1] {
                path.move(to: CGPoint(x: sign * 6, y: -5))
                path.addLine(to: CGPoint(x: sign * 11, y: 0))
                path.addLine(to: CGPoint(x: sign * 6, y: 5))
            }
            let angle: CGFloat = cursor == "ns-resize" ? .pi / 2 : cursor == "nwse-resize" ? .pi / 4 : cursor == "nesw-resize" ? -.pi / 4 : 0
            path.apply(CGAffineTransform(rotationAngle: angle))
        }
        let shape = UIBezierPath(cgPath: path.cgPath.copy(strokingWithWidth: 2, lineCap: .round, lineJoin: .round, miterLimit: 1))
        return UIPointerStyle(shape: .path(shape))
    }

    static let script = """
    (() => {
        let previous = '';
        function update(event) {
            if (event.pointerType !== 'mouse') return;
            const handle = event.target instanceof Element ? event.target.closest('.handle') : null;
            const rect = handle?.getBoundingClientRect();
            const cursor = handle ? (handle.classList.contains('rotate') ? 'rotate' : getComputedStyle(handle).cursor) : '';
            const body = { cursor, x: rect?.x, y: rect?.y, width: rect?.width, height: rect?.height };
            const next = JSON.stringify(body);
            if (next === previous) return;
            previous = next;
            window.webkit.messageHandlers.labelmakerPointer.postMessage(body);
        }
        document.addEventListener('pointerover', update, true);
        document.addEventListener('pointermove', update, true);
        document.addEventListener('pointerout', event => {
            if (event.relatedTarget) return;
            previous = '';
            window.webkit.messageHandlers.labelmakerPointer.postMessage({ cursor: '' });
        }, true);
    })();
    """
}
