import XCTest
@testable import Labelmaker

final class BundledWebAppSchemeHandlerTests: XCTestCase {
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
