import XCTest
@testable import Labelmaker

final class BundledWebAppSchemeHandlerTests: XCTestCase {
    func testOnlyTheBundledEntryCanUseNavigationAndTheNativeBridge() throws {
        let entry = URL(string: "labelmaker://app/index.html")
        XCTAssertTrue(BundledWebAppSchemeHandler.isAppFrame(entry, isMainFrame: true))
        XCTAssertFalse(BundledWebAppSchemeHandler.isAppFrame(entry, isMainFrame: false))
        for value in [
            "labelmaker://app/assets/index.js",
            "labelmaker://other/index.html",
            "labelmaker://user@app/index.html",
            "labelmaker://app:123/index.html",
            "labelmaker://app/index.html?remote=true",
            "labelmaker://app/index.html#other",
            "https://app/index.html",
            "file:///index.html",
            "about:blank",
            "data:text/html,<script></script>",
            "blob:labelmaker://app/document",
        ] {
            XCTAssertFalse(BundledWebAppSchemeHandler.isAppFrame(URL(string: value), isMainFrame: true), value)
        }
        XCTAssertFalse(BundledWebAppSchemeHandler.isAppFrame(nil, isMainFrame: true))
    }

    func testAppDeclaresCameraUseForImageImport() throws {
        let description = try XCTUnwrap(
            Bundle.main.object(forInfoDictionaryKey: "NSCameraUsageDescription") as? String
        )

        XCTAssertFalse(description.isEmpty)
    }

    func testAcceptsBundledAppResourcePaths() throws {
        let url = try XCTUnwrap(URL(string: "labelmaker://app/assets/index.js"))

        XCTAssertEqual(
            BundledWebAppSchemeHandler.resourcePath(for: url),
            "assets/index.js"
        )
    }

    func testRejectsOtherOriginsAndTraversal() throws {
        let urls = try [
            "https://app/index.html",
            "labelmaker://other/index.html",
            "labelmaker://app/../Info.plist",
            "labelmaker://app/%2e%2e/Info.plist",
            "labelmaker://app/index.html?remote=true",
        ].map { try XCTUnwrap(URL(string: $0)) }

        for url in urls {
            XCTAssertNil(BundledWebAppSchemeHandler.resourcePath(for: url))
        }
    }
}
