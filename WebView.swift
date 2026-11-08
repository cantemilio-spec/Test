import SwiftUI
import WebKit

/// Cria o WKWebView e carrega o programa (index.html) que está dentro do app.
/// O baseURL https faz a página rodar como "contexto seguro" (necessário para
/// a verificação da senha) e dá a ela um endereço fixo, para que os pensamentos
/// guardados no aparelho continuem lá quando você abre o app de novo.
private func makePensamentosWebView() -> WKWebView {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()

    let webView = WKWebView(frame: .zero, configuration: config)

    #if DEBUG
    if #available(iOS 16.4, macOS 13.3, *) {
        webView.isInspectable = true
    }
    #endif

    if let url = Bundle.main.url(forResource: "index", withExtension: "html"),
       let html = try? String(contentsOf: url, encoding: .utf8) {
        webView.loadHTMLString(html, baseURL: URL(string: "https://pensamentos.app"))
    } else {
        webView.loadHTMLString("<body style='font-family:monospace;padding:2rem'>index.html não foi encontrado no app.</body>", baseURL: nil)
    }
    return webView
}

#if os(iOS)
struct PensamentosWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let webView = makePensamentosWebView()
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        return webView
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
#else
struct PensamentosWebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView {
        let webView = makePensamentosWebView()
        webView.setValue(false, forKey: "drawsBackground")
        return webView
    }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
#endif
