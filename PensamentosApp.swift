import SwiftUI

@main
struct PensamentosApp: App {
    var body: some Scene {
        WindowGroup {
            PensamentosWebView()
                .background(Color(red: 0.08, green: 0.07, blue: 0.05).ignoresSafeArea())
                .ignoresSafeArea(.container, edges: .all)
        }
    }
}
