import Foundation
import WebKit

final class BundledWebAppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "labelmaker"
    static let host = "app"

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard
            let url = urlSchemeTask.request.url,
            let relativePath = Self.resourcePath(for: url),
            let root = Bundle.main.resourceURL?.appendingPathComponent("WebApp", isDirectory: true)
        else {
            urlSchemeTask.didFailWithError(Self.notFoundError)
            return
        }

        let resourceURL = root.appendingPathComponent(relativePath, isDirectory: false).standardizedFileURL
        let rootPath = root.standardizedFileURL.path + "/"
        guard resourceURL.path.hasPrefix(rootPath) else {
            urlSchemeTask.didFailWithError(Self.notFoundError)
            return
        }

        do {
            let data = try Data(contentsOf: resourceURL, options: .mappedIfSafe)
            let response = URLResponse(
                url: url,
                mimeType: Self.mimeType(for: resourceURL.pathExtension),
                expectedContentLength: data.count,
                textEncodingName: Self.isTextExtension(resourceURL.pathExtension) ? "utf-8" : nil
            )
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            urlSchemeTask.didFailWithError(Self.notFoundError)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    static func resourcePath(for url: URL) -> String? {
        guard
            url.scheme?.lowercased() == scheme,
            url.host?.lowercased() == host,
            url.query == nil,
            url.fragment == nil
        else {
            return nil
        }
        let path = url.path.removingPercentEncoding ?? url.path
        let components = path.split(separator: "/", omittingEmptySubsequences: true)
        guard
            !components.isEmpty,
            components.allSatisfy({ $0 != "." && $0 != ".." && !$0.contains("\\") && !$0.contains("\0") })
        else {
            return nil
        }
        return components.joined(separator: "/")
    }

    private static let notFoundError = NSError(
        domain: NSURLErrorDomain,
        code: NSURLErrorFileDoesNotExist
    )

    private static func isTextExtension(_ value: String) -> Bool {
        ["css", "html", "js", "json", "svg"].contains(value.lowercased())
    }

    private static func mimeType(for fileExtension: String) -> String {
        switch fileExtension.lowercased() {
        case "css": "text/css"
        case "html": "text/html"
        case "js": "text/javascript"
        case "json": "application/json"
        case "svg": "image/svg+xml"
        case "png": "image/png"
        case "jpg", "jpeg": "image/jpeg"
        case "gif": "image/gif"
        case "webp": "image/webp"
        case "bmp": "image/bmp"
        case "woff": "font/woff"
        case "woff2": "font/woff2"
        default: "application/octet-stream"
        }
    }
}
