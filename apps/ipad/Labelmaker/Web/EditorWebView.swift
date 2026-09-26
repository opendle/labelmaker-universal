import UIKit
import WebKit

final class EditorWebView: WKWebView {
    override var keyCommands: [UIKeyCommand]? {
        let shortcuts: [(String, UIKeyModifierFlags)] = [
            ("z", .command), ("z", [.command, .shift]), ("y", .command),
            ("s", .command), ("s", [.command, .shift]),
            ("+", .command), ("=", .command), ("-", .command), ("0", .command)
        ]
        return shortcuts.map { input, modifiers in
            let command = UIKeyCommand(input: input, modifierFlags: modifiers, action: #selector(editorCommand(_:)))
            command.wantsPriorityOverSystemBehavior = true
            return command
        } + (super.keyCommands ?? [])
    }

    @objc func editorCommand(_ command: UIKeyCommand) {
        guard let input = command.input else { return }
        callAsyncJavaScript(
            """
            const target = document.activeElement || document.body;
            target.dispatchEvent(new KeyboardEvent('keydown', {
                key: key, metaKey: true, shiftKey: shift, bubbles: true, cancelable: true
            }));
            """,
            arguments: ["key": input, "shift": command.modifierFlags.contains(.shift)],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }
}
