import XCTest

@testable import Labelmaker

final class MakeIDBluetoothTransportTests: XCTestCase {
  func testDeviceIDUsesStableLowercaseCoreBluetoothUUID() {
    let identifier = UUID(uuidString: "01234567-89AB-CDEF-0123-456789ABCDEF")!

    XCTAssertEqual(
      MakeIDBluetoothIdentity.deviceID(for: identifier),
      "ipad-ble-01234567-89ab-cdef-0123-456789abcdef"
    )
  }

  func testSavedDeviceIDParserAcceptsCanonicalIPadAndMacPrefixes() {
    let expected = UUID(uuidString: "01234567-89AB-CDEF-0123-456789ABCDEF")!

    XCTAssertEqual(
      MakeIDBluetoothIdentity.uuid(
        fromDeviceID: "ipad-ble-01234567-89ab-cdef-0123-456789abcdef"
      ),
      expected
    )
    XCTAssertEqual(
      MakeIDBluetoothIdentity.uuid(
        fromDeviceID: "MACOS-BLE-01234567-89AB-CDEF-0123-456789ABCDEF"
      ),
      expected
    )
  }

  func testSavedDeviceIDParserRejectsMalformedValues() {
    XCTAssertNil(MakeIDBluetoothIdentity.uuid(fromDeviceID: ""))
    XCTAssertNil(MakeIDBluetoothIdentity.uuid(fromDeviceID: "ipad-ble-not-a-uuid"))
    XCTAssertNil(
      MakeIDBluetoothIdentity.uuid(
        fromDeviceID: "ipad-ble-01234567-89ab-cdef-0123-456789abcdef-extra"
      )
    )
    XCTAssertNil(
      MakeIDBluetoothIdentity.uuid(
        fromDeviceID: "other-01234567-89ab-cdef-0123-456789abcdef"
      )
    )
  }

  func testCompatibleNameFilterAcceptsOnlySupportedMakeIDFamilies() {
    let accepted: [String?] = [
      "YichipFPGA-1308",
      "MakeID E1",
      "MakeID E1-Lab",
      "E124H00894",
      " e124h00894 ",
      "MakeID L1",
      "L1-300",
      "P31S-Workshop",
      "MakeID Q31",
      "GP31-A",
    ]
    let rejected: [String?] = [
      nil,
      "",
      "MakeID M1",
      "MakeID D50",
      "EP53",
      "E124000894",
      "E12H00894",
      "E124É00894",
      "Nearby Speaker",
    ]

    for name in accepted {
      XCTAssertTrue(MakeIDBluetoothIdentity.isCompatibleName(name), "Rejected \(name ?? "nil")")
    }
    for name in rejected {
      XCTAssertFalse(MakeIDBluetoothIdentity.isCompatibleName(name), "Accepted \(name ?? "nil")")
    }
  }

  func testDisplayNameUsesAStableFallback() {
    XCTAssertEqual(
      MakeIDBluetoothIdentity.displayName(
        advertisedName: " E124H00894 ",
        peripheralName: "Cached name"
      ),
      "E124H00894"
    )
    XCTAssertEqual(
      MakeIDBluetoothIdentity.displayName(advertisedName: nil, peripheralName: nil),
      "MakeID printer"
    )
  }

  func testProtocolFamiliesUseTheExpectedGATTEndpoints() {
    XCTAssertEqual(MakeIDBluetoothProtocolFamily.abf0.serviceUUID.uuidString, "ABF0")
    XCTAssertEqual(MakeIDBluetoothProtocolFamily.abf0.writeUUID.uuidString, "ABF1")
    XCTAssertEqual(MakeIDBluetoothProtocolFamily.abf0.notifyUUID.uuidString, "ABF2")
    XCTAssertEqual(MakeIDBluetoothProtocolFamily.ff00.serviceUUID.uuidString, "FF00")
    XCTAssertEqual(MakeIDBluetoothProtocolFamily.ff00.writeUUID.uuidString, "FF02")
    XCTAssertEqual(MakeIDBluetoothProtocolFamily.ff00.notifyUUID.uuidString, "FF01")
  }

  func testDiscoveryRecordsHaveDeterministicOrder() {
    let records = [
      "ipad-ble-b": MakeIDBluetoothDeviceRecord(id: "ipad-ble-b", name: "Printer B"),
      "ipad-ble-a": MakeIDBluetoothDeviceRecord(id: "ipad-ble-a", name: "Printer A"),
      "ipad-ble-c": MakeIDBluetoothDeviceRecord(id: "ipad-ble-c", name: "Printer A"),
    ]

    XCTAssertEqual(
      MakeIDBluetoothIdentity.sortedRecords(records).map(\.id),
      ["ipad-ble-a", "ipad-ble-c", "ipad-ble-b"]
    )
  }

  func testErrorHasAStableSafeCodeAndMessage() throws {
    let failure = MakeIDBluetoothError(
      code: .bluetoothOff,
      message: "Bluetooth is off. Turn on Bluetooth, then try again."
    )
    let encoded = try JSONEncoder().encode(failure)
    let decoded = try JSONDecoder().decode(MakeIDBluetoothError.self, from: encoded)

    XCTAssertEqual(decoded, failure)
    XCTAssertEqual(decoded.errorDescription, failure.message)
  }
}
