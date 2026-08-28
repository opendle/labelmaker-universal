import SwiftUI

@main
struct LabelmakerApp: App {
    var body: some Scene {
        WindowGroup {
            LabelmakerWebView()
                .ignoresSafeArea(.container)
        }
    }
}
