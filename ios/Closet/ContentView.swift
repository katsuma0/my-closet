import SwiftUI

struct ContentView: View {
    var body: some View {
        WebView()
            // Edge to edge, under the notch and the home indicator: the page keeps its
            // content clear of them with env(safe-area-inset-*). Ignoring the keyboard
            // area too lets WebKit move the page for the keyboard itself.
            .ignoresSafeArea()
    }
}
