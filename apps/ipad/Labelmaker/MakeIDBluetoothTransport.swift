@preconcurrency import CoreBluetooth
import Foundation

public struct MakeIDBluetoothDeviceRecord: Codable, Equatable, Sendable {
  public let id: String
  public let name: String

  public init(id: String, name: String) {
    self.id = id
    self.name = name
  }
}

public struct MakeIDBluetoothError: Codable, Equatable, Error, LocalizedError, Sendable {
  public enum Code: String, Codable, Sendable {
    case bluetoothUnavailable = "bluetooth-unavailable"
    case bluetoothUnauthorized = "bluetooth-unauthorized"
    case bluetoothOff = "bluetooth-off"
    case bluetoothTimeout = "bluetooth-timeout"
    case invalidDeviceID = "invalid-device-id"
    case invalidBase64 = "invalid-base64"
    case invalidState = "invalid-state"
    case deviceNotFound = "device-not-found"
    case connectionFailed = "connection-failed"
    case connectionTimeout = "connection-timeout"
    case serviceNotFound = "service-not-found"
    case characteristicsMissing = "characteristics-missing"
    case notificationsFailed = "notifications-failed"
    case disconnected = "disconnected"
    case writeFailed = "write-failed"
    case readTimeout = "read-timeout"
    case replyOverflow = "reply-overflow"
    case closed = "closed"
  }

  public let code: Code
  public let message: String

  public init(code: Code, message: String) {
    self.code = code
    self.message = message
  }

  public var errorDescription: String? { message }
}

/// Pure identity and discovery rules shared by the transport and its tests.
enum MakeIDBluetoothIdentity {
  static let devicePrefix = "ipad-ble-"
  private static let acceptedDevicePrefixes = [devicePrefix, "macos-ble-"]

  static func deviceID(for identifier: UUID) -> String {
    devicePrefix + identifier.uuidString.lowercased()
  }

  static func uuid(fromDeviceID deviceID: String) -> UUID? {
    let lowercased = deviceID.lowercased()
    guard let prefix = acceptedDevicePrefixes.first(where: { lowercased.hasPrefix($0) }) else {
      return nil
    }
    let suffix = String(lowercased.dropFirst(prefix.count))
    guard let identifier = UUID(uuidString: suffix),
      identifier.uuidString.lowercased() == suffix
    else {
      return nil
    }
    return identifier
  }

  static func isCompatibleName(_ name: String?) -> Bool {
    guard let name = name?.trimmingCharacters(in: .whitespacesAndNewlines),
      !name.isEmpty
    else {
      return false
    }
    let normalized = name.uppercased()
    if normalized.hasPrefix("YICHIPFPGA-") || normalized == "MAKEID E1"
      || normalized.hasPrefix("MAKEID E1-")
    {
      return true
    }

    // Known E1 serial names use E1, two digits, one letter, and five digits.
    guard normalized.count == 10, normalized.hasPrefix("E1") else {
      return false
    }
    let characters = Array(normalized)
    let isASCIIDigit: (Character) -> Bool = { character in
      character.asciiValue.map { (48...57).contains($0) } == true
    }
    let isASCIIUppercaseLetter: (Character) -> Bool = { character in
      character.asciiValue.map { (65...90).contains($0) } == true
    }
    return characters[2...3].allSatisfy(isASCIIDigit)
      && isASCIIUppercaseLetter(characters[4])
      && characters[5...9].allSatisfy(isASCIIDigit)
  }

  static func displayName(advertisedName: String?, peripheralName: String?) -> String {
    for candidate in [advertisedName, peripheralName] {
      if let value = candidate?.trimmingCharacters(in: .whitespacesAndNewlines),
        !value.isEmpty
      {
        return value
      }
    }
    return "MakeID E1"
  }

  static func sortedRecords(_ records: [String: MakeIDBluetoothDeviceRecord])
    -> [MakeIDBluetoothDeviceRecord]
  {
    records.values.sorted { left, right in
      if left.name.localizedCaseInsensitiveCompare(right.name) == .orderedSame {
        return left.id < right.id
      }
      return left.name.localizedCaseInsensitiveCompare(right.name) == .orderedAscending
    }
  }
}

/// A raw MakeID E1 CoreBluetooth byte transport for an Apple mobile application shell.
///
/// The class owns discovery and the GATT connection only. It does not parse
/// MakeID packets and it does not know about workspaces, plates, or rasters.
/// Create and call it on the main actor, as a WKScriptMessageHandler normally
/// does. Calls can arrive together: writes and reads use independent FIFO
/// queues, and CoreBluetooth work stays serialized on the main queue.
@MainActor
public final class MakeIDBluetoothTransport: NSObject {
  private static let serviceUUID = CBUUID(string: "ABF0")
  private static let writeUUID = CBUUID(string: "ABF1")
  private static let notifyUUID = CBUUID(string: "ABF2")
  private static let maximumBufferedReplyBytes = 1_048_576

  private enum Phase: Equatable {
    case idle
    case discovering
    case findingSavedPeripheral
    case connecting
    case discoveringServices
    case discoveringCharacteristics
    case enablingNotifications
    case ready
    case closing
  }

  private final class PendingWrite {
    let data: Data
    var offset = 0
    let continuation: CheckedContinuation<Void, Error>

    init(data: Data, continuation: CheckedContinuation<Void, Error>) {
      self.data = data
      self.continuation = continuation
    }
  }

  private final class PendingRead {
    let id = UUID()
    let continuation: CheckedContinuation<Data, Error>

    init(continuation: CheckedContinuation<Data, Error>) {
      self.continuation = continuation
    }
  }

  private var central: CBCentralManager!
  private var phase = Phase.idle
  private var peripheral: CBPeripheral?
  private var writeCharacteristic: CBCharacteristic?
  private var notifyCharacteristic: CBCharacteristic?
  private var writeType: CBCharacteristicWriteType = .withoutResponse
  private var terminalError: MakeIDBluetoothError?

  private var powerToken: UUID?
  private var powerContinuation: CheckedContinuation<Void, Error>?

  private var discoveredRecords: [String: MakeIDBluetoothDeviceRecord] = [:]
  private var discoveryToken: UUID?
  private var discoveryContinuation: CheckedContinuation<[MakeIDBluetoothDeviceRecord], Error>?

  private var targetIdentifier: UUID?
  private var connectionToken: UUID?
  private var connectionContinuation: CheckedContinuation<Void, Error>?

  private var writes: [PendingWrite] = []
  private var writeAwaitingResponse = false
  private var writeInFlightLength = 0
  private var replyChunks: [Data] = []
  private var bufferedReplyBytes = 0
  private var reads: [PendingRead] = []

  private var closeToken: UUID?
  private var closeContinuation: CheckedContinuation<Void, Never>?

  public override init() {
    super.init()
    central = CBCentralManager(
      delegate: self,
      queue: .main,
      options: [CBCentralManagerOptionShowPowerAlertKey: false]
    )
  }

  /// Find MakeID E1 printers. CoreBluetooth has no public paired-device list.
  /// With `includeUnpaired` false, this returns connected ABF0 peripherals.
  /// With it true, this scans nearby advertisements and applies the strict E1
  /// name filter. A connection still validates ABF0, ABF1, and ABF2.
  public func discover(timeoutMs: Int, includeUnpaired: Bool)
    async throws -> [MakeIDBluetoothDeviceRecord]
  {
    guard phase == .idle else {
      throw error(.invalidState, "Finish the current Bluetooth operation, then try again.")
    }

    // Reserve this operation before the first suspension point. This prevents
    // another bridge call from replacing the pending power continuation.
    phase = .discovering
    do {
      try await ensurePoweredOn(timeoutMs: timeoutMs)
    } catch {
      phase = .idle
      throw error
    }
    discoveredRecords.removeAll(keepingCapacity: true)

    for connected in central.retrieveConnectedPeripherals(withServices: [Self.serviceUUID]) {
      if MakeIDBluetoothIdentity.isCompatibleName(connected.name) {
        record(connected, advertisedName: nil)
      }
    }

    guard includeUnpaired else {
      phase = .idle
      return MakeIDBluetoothIdentity.sortedRecords(discoveredRecords)
    }

    let boundedTimeout = bounded(timeoutMs)
    return try await withCheckedThrowingContinuation { continuation in
      let token = UUID()
      discoveryToken = token
      discoveryContinuation = continuation
      central.scanForPeripherals(
        withServices: nil,
        options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
      )
      after(milliseconds: boundedTimeout) { [weak self] in
        self?.finishDiscovery(token: token)
      }
    }
  }

  /// Restore and prepare a saved CoreBluetooth peripheral.
  public func connect(deviceId: String, timeoutMs: Int) async throws {
    guard phase == .idle else {
      throw error(.invalidState, "Finish the current Bluetooth operation, then try again.")
    }
    guard let identifier = MakeIDBluetoothIdentity.uuid(fromDeviceID: deviceId) else {
      throw error(.invalidDeviceID, "The saved Bluetooth printer ID is invalid.")
    }

    // Reserve this operation before waiting for the initial central-manager
    // state callback. Discovery and connection are mutually exclusive.
    phase = .findingSavedPeripheral
    terminalError = nil
    clearBuffers()
    let boundedTimeout = bounded(timeoutMs)
    let startedAt = DispatchTime.now().uptimeNanoseconds
    do {
      try await ensurePoweredOn(timeoutMs: boundedTimeout)
    } catch {
      phase = .idle
      throw error
    }
    let elapsedMs = Int((DispatchTime.now().uptimeNanoseconds - startedAt) / 1_000_000)
    let remainingMs = max(1, boundedTimeout - elapsedMs)

    try await withCheckedThrowingContinuation { continuation in
      let token = UUID()
      connectionToken = token
      connectionContinuation = continuation
      targetIdentifier = identifier

      after(milliseconds: remainingMs) { [weak self] in
        self?.connectionTimedOut(token: token)
      }

      if let known = central.retrievePeripherals(withIdentifiers: [identifier]).first {
        beginConnection(to: known)
      } else {
        phase = .findingSavedPeripheral
        central.scanForPeripherals(
          withServices: nil,
          options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
        )
      }
    }
  }

  /// Queue raw bytes for ABF1. The promise completes when CoreBluetooth has
  /// accepted all chunks, or acknowledged all chunks on a write-with-response
  /// fallback characteristic.
  public func write(_ data: Data) async throws {
    try requireReady()
    guard !data.isEmpty else { return }
    try await withCheckedThrowingContinuation { continuation in
      writes.append(PendingWrite(data: data, continuation: continuation))
      drainWrites()
    }
  }

  /// A JSON bridge convenience method. Base64 is decoded before raw writing.
  public func write(base64Encoded value: String) async throws {
    guard let data = Data(base64Encoded: value) else {
      throw error(.invalidBase64, "The Bluetooth write data is invalid.")
    }
    try await write(data)
  }

  /// Return one notification chunk from ABF2. Packet framing stays in the
  /// shared TypeScript adapter because one packet can use several chunks and
  /// one chunk can contain several packets.
  public func read(timeoutMs: Int) async throws -> Data {
    try requireReady()
    if !replyChunks.isEmpty {
      let result = replyChunks.removeFirst()
      bufferedReplyBytes -= result.count
      return result
    }

    let boundedTimeout = bounded(timeoutMs)
    return try await withCheckedThrowingContinuation { continuation in
      let request = PendingRead(continuation: continuation)
      reads.append(request)
      after(milliseconds: boundedTimeout) { [weak self] in
        self?.readTimedOut(id: request.id, timeoutMs: boundedTimeout)
      }
    }
  }

  /// A JSON bridge convenience method.
  public func readBase64(timeoutMs: Int) async throws -> String {
    try await read(timeoutMs: timeoutMs).base64EncodedString()
  }

  /// Stop discovery or close the active connection. The same transport
  /// object can start a later discovery and connection after this completes.
  public func close() async {
    terminalError = nil
    finishDiscovery(
      throwing: error(.closed, "The Bluetooth operation was closed."),
      token: discoveryToken
    )
    failPowerWaiter(error(.closed, "The Bluetooth operation was closed."))
    failConnectionWaiter(error(.closed, "The Bluetooth connection was closed."))
    failQueuedIO(error(.closed, "The Bluetooth connection was closed."))
    clearBuffers()
    central.stopScan()

    guard let peripheral, peripheral.state != .disconnected else {
      resetConnection()
      return
    }

    phase = .closing
    await withCheckedContinuation { continuation in
      let token = UUID()
      closeToken = token
      closeContinuation = continuation
      if let notifyCharacteristic, notifyCharacteristic.isNotifying,
        peripheral.state == .connected
      {
        peripheral.setNotifyValue(false, for: notifyCharacteristic)
      } else {
        central.cancelPeripheralConnection(peripheral)
      }
      after(milliseconds: 1_500) { [weak self] in
        self?.finishClose(token: token)
      }
    }
  }

  private func ensurePoweredOn(timeoutMs: Int) async throws {
    switch central.state {
    case .poweredOn:
      return
    case .unsupported:
      throw stateError(for: .unsupported)
    case .unauthorized:
      throw stateError(for: .unauthorized)
    case .poweredOff:
      throw stateError(for: .poweredOff)
    case .unknown, .resetting:
      break
    @unknown default:
      throw error(.bluetoothUnavailable, "Bluetooth is not available on this device.")
    }

    let boundedTimeout = bounded(timeoutMs)
    try await withCheckedThrowingContinuation { continuation in
      let token = UUID()
      powerToken = token
      powerContinuation = continuation
      after(milliseconds: boundedTimeout) { [weak self] in
        guard let self, self.powerToken == token else { return }
        self.failPowerWaiter(
          self.error(.bluetoothTimeout, "Bluetooth did not become ready in time.")
        )
      }
    }
  }

  private func beginConnection(to peripheral: CBPeripheral) {
    central.stopScan()
    self.peripheral = peripheral
    peripheral.delegate = self
    phase = .connecting
    central.connect(peripheral, options: nil)
  }

  private func connectionTimedOut(token: UUID) {
    guard connectionToken == token, connectionContinuation != nil else { return }
    let failure = error(
      .connectionTimeout,
      "The Bluetooth printer did not become ready in time."
    )
    failConnectionWaiter(failure)
    terminalError = failure
    central.stopScan()
    if let peripheral, peripheral.state != .disconnected {
      central.cancelPeripheralConnection(peripheral)
    }
    resetConnection(keepPeripheralUntilDisconnect: true)
  }

  private func finishDiscovery(token: UUID?) {
    guard token != nil, token == discoveryToken else { return }
    central.stopScan()
    phase = .idle
    discoveryToken = nil
    let continuation = discoveryContinuation
    discoveryContinuation = nil
    continuation?.resume(returning: MakeIDBluetoothIdentity.sortedRecords(discoveredRecords))
  }

  private func finishDiscovery(throwing failure: MakeIDBluetoothError, token: UUID?) {
    guard token != nil, token == discoveryToken else { return }
    central.stopScan()
    phase = .idle
    discoveryToken = nil
    let continuation = discoveryContinuation
    discoveryContinuation = nil
    continuation?.resume(throwing: failure)
  }

  private func record(_ peripheral: CBPeripheral, advertisedName: String?) {
    let id = MakeIDBluetoothIdentity.deviceID(for: peripheral.identifier)
    let record = MakeIDBluetoothDeviceRecord(
      id: id,
      name: MakeIDBluetoothIdentity.displayName(
        advertisedName: advertisedName,
        peripheralName: peripheral.name
      )
    )
    discoveredRecords[id] = record
  }

  private func requireReady() throws {
    if let terminalError { throw terminalError }
    guard phase == .ready,
      peripheral?.state == .connected,
      writeCharacteristic != nil,
      notifyCharacteristic?.isNotifying == true
    else {
      throw error(.closed, "The Bluetooth printer connection is closed.")
    }
  }

  private func drainWrites() {
    guard phase == .ready,
      let peripheral,
      let writeCharacteristic,
      !writes.isEmpty
    else { return }

    let maximumLength = peripheral.maximumWriteValueLength(for: writeType)
    guard maximumLength > 0 else {
      failSession(error(.writeFailed, "The Bluetooth printer write size is invalid."))
      return
    }

    if writeType == .withResponse {
      guard !writeAwaitingResponse, let request = writes.first else { return }
      let length = min(maximumLength, request.data.count - request.offset)
      let next = request.data.subdata(in: request.offset..<(request.offset + length))
      writeAwaitingResponse = true
      writeInFlightLength = length
      peripheral.writeValue(next, for: writeCharacteristic, type: .withResponse)
      return
    }

    while let request = writes.first, peripheral.canSendWriteWithoutResponse {
      let length = min(maximumLength, request.data.count - request.offset)
      let next = request.data.subdata(in: request.offset..<(request.offset + length))
      peripheral.writeValue(next, for: writeCharacteristic, type: .withoutResponse)
      request.offset += length
      if request.offset == request.data.count {
        writes.removeFirst()
        request.continuation.resume()
      }
    }
  }

  private func receive(_ data: Data) {
    guard !data.isEmpty else { return }
    if !reads.isEmpty {
      let request = reads.removeFirst()
      request.continuation.resume(returning: data)
      return
    }

    guard bufferedReplyBytes + data.count <= Self.maximumBufferedReplyBytes else {
      failSession(error(.replyOverflow, "The Bluetooth printer sent too much unread data."))
      return
    }
    replyChunks.append(data)
    bufferedReplyBytes += data.count
  }

  private func readTimedOut(id: UUID, timeoutMs: Int) {
    guard let index = reads.firstIndex(where: { $0.id == id }) else { return }
    let request = reads.remove(at: index)
    request.continuation.resume(
      throwing: error(.readTimeout, "The Bluetooth printer did not reply in time.")
    )
  }

  private func failSession(_ failure: MakeIDBluetoothError) {
    terminalError = failure
    failQueuedIO(failure)
    if let peripheral, peripheral.state != .disconnected {
      central.cancelPeripheralConnection(peripheral)
    }
    resetConnection(keepPeripheralUntilDisconnect: true)
  }

  private func failQueuedIO(_ failure: MakeIDBluetoothError) {
    let pendingWrites = writes
    writes.removeAll()
    writeAwaitingResponse = false
    writeInFlightLength = 0
    for request in pendingWrites {
      request.continuation.resume(throwing: failure)
    }

    let pendingReads = reads
    reads.removeAll()
    for request in pendingReads {
      request.continuation.resume(throwing: failure)
    }
  }

  private func clearBuffers() {
    replyChunks.removeAll(keepingCapacity: true)
    bufferedReplyBytes = 0
  }

  private func failPowerWaiter(_ failure: MakeIDBluetoothError) {
    powerToken = nil
    let continuation = powerContinuation
    powerContinuation = nil
    continuation?.resume(throwing: failure)
  }

  private func failConnectionWaiter(_ failure: MakeIDBluetoothError) {
    connectionToken = nil
    targetIdentifier = nil
    let continuation = connectionContinuation
    connectionContinuation = nil
    continuation?.resume(throwing: failure)
  }

  private func completeConnection() {
    connectionToken = nil
    targetIdentifier = nil
    terminalError = nil
    let continuation = connectionContinuation
    connectionContinuation = nil
    continuation?.resume()
  }

  private func resetConnection(keepPeripheralUntilDisconnect: Bool = false) {
    if !keepPeripheralUntilDisconnect {
      peripheral?.delegate = nil
      peripheral = nil
    }
    writeCharacteristic = nil
    notifyCharacteristic = nil
    writeType = .withoutResponse
    writeAwaitingResponse = false
    writeInFlightLength = 0
    if phase != .closing {
      phase = .idle
    }
  }

  private func finishClose(token: UUID?) {
    guard token != nil, token == closeToken else { return }
    if let peripheral, peripheral.state != .disconnected {
      central.cancelPeripheralConnection(peripheral)
    }
    closeToken = nil
    let continuation = closeContinuation
    closeContinuation = nil
    resetConnection()
    phase = .idle
    continuation?.resume()
  }

  private func failForCentralState(_ state: CBManagerState) {
    let failure = stateError(for: state)
    failPowerWaiter(failure)
    finishDiscovery(throwing: failure, token: discoveryToken)
    if connectionContinuation != nil {
      failConnectionWaiter(failure)
      terminalError = failure
      resetConnection(keepPeripheralUntilDisconnect: true)
    }
    if phase == .ready {
      failSession(failure)
    }
  }

  private func stateError(for state: CBManagerState) -> MakeIDBluetoothError {
    switch state {
    case .unauthorized:
      return error(
        .bluetoothUnauthorized,
        "Bluetooth access is not allowed. Allow Bluetooth access for Labelmaker, then try again."
      )
    case .poweredOff:
      return error(.bluetoothOff, "Bluetooth is off. Turn on Bluetooth, then try again.")
    case .unsupported:
      return error(.bluetoothUnavailable, "This device does not support Bluetooth Low Energy.")
    default:
      return error(.bluetoothUnavailable, "Bluetooth is not available on this device.")
    }
  }

  private func error(_ code: MakeIDBluetoothError.Code, _ message: String)
    -> MakeIDBluetoothError
  {
    MakeIDBluetoothError(code: code, message: message)
  }

  private func bounded(_ milliseconds: Int) -> Int {
    min(max(milliseconds, 1), 120_000)
  }

  private func after(milliseconds: Int, action: @escaping @MainActor () -> Void) {
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(milliseconds)) {
      MainActor.assumeIsolated {
        action()
      }
    }
  }
}

extension MakeIDBluetoothTransport: @preconcurrency CBCentralManagerDelegate {
  public func centralManagerDidUpdateState(_ central: CBCentralManager) {
    switch central.state {
    case .poweredOn:
      powerToken = nil
      let continuation = powerContinuation
      powerContinuation = nil
      continuation?.resume()
    case .unauthorized, .poweredOff, .unsupported:
      failForCentralState(central.state)
    case .unknown, .resetting:
      break
    @unknown default:
      failForCentralState(central.state)
    }
  }

  public func centralManager(
    _ central: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi _: NSNumber
  ) {
    let advertisedName = advertisementData[CBAdvertisementDataLocalNameKey] as? String

    if phase == .discovering,
      MakeIDBluetoothIdentity.isCompatibleName(advertisedName ?? peripheral.name)
    {
      record(peripheral, advertisedName: advertisedName)
    }

    if phase == .findingSavedPeripheral,
      peripheral.identifier == targetIdentifier
    {
      beginConnection(to: peripheral)
    }
  }

  public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    guard peripheral === self.peripheral, phase == .connecting else {
      central.cancelPeripheralConnection(peripheral)
      return
    }
    phase = .discoveringServices
    peripheral.discoverServices([Self.serviceUUID])
  }

  public func centralManager(
    _ central: CBCentralManager,
    didFailToConnect peripheral: CBPeripheral,
    error: Error?
  ) {
    guard peripheral === self.peripheral else { return }
    let failure = self.error(.connectionFailed, "Could not connect to the Bluetooth printer.")
    terminalError = failure
    failConnectionWaiter(failure)
    resetConnection()
  }

  public func centralManager(
    _ central: CBCentralManager,
    didDisconnectPeripheral peripheral: CBPeripheral,
    error: Error?
  ) {
    guard peripheral === self.peripheral else { return }
    if phase == .closing {
      finishClose(token: closeToken)
      return
    }

    let failure = self.error(.disconnected, "The Bluetooth printer disconnected.")
    terminalError = failure
    failConnectionWaiter(failure)
    failQueuedIO(failure)
    resetConnection()
  }
}

extension MakeIDBluetoothTransport: @preconcurrency CBPeripheralDelegate {
  public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard peripheral === self.peripheral, phase == .discoveringServices else { return }
    if error != nil {
      failConnectionSetup(
        self.error(.connectionFailed, "Could not find the printer Bluetooth service.")
      )
      return
    }
    guard let service = peripheral.services?.first(where: { $0.uuid == Self.serviceUUID }) else {
      failConnectionSetup(
        self.error(.serviceNotFound, "The selected device does not provide the MakeID service.")
      )
      return
    }
    phase = .discoveringCharacteristics
    peripheral.discoverCharacteristics([Self.writeUUID, Self.notifyUUID], for: service)
  }

  public func peripheral(
    _ peripheral: CBPeripheral,
    didDiscoverCharacteristicsFor service: CBService,
    error: Error?
  ) {
    guard peripheral === self.peripheral, phase == .discoveringCharacteristics else { return }
    if error != nil {
      failConnectionSetup(
        self.error(.connectionFailed, "Could not prepare the printer Bluetooth service.")
      )
      return
    }

    writeCharacteristic = service.characteristics?.first { $0.uuid == Self.writeUUID }
    notifyCharacteristic = service.characteristics?.first { $0.uuid == Self.notifyUUID }
    guard let writeCharacteristic, let notifyCharacteristic else {
      failConnectionSetup(
        self.error(.characteristicsMissing, "The printer Bluetooth service is incomplete.")
      )
      return
    }

    if writeCharacteristic.properties.contains(.writeWithoutResponse) {
      writeType = .withoutResponse
    } else if writeCharacteristic.properties.contains(.write) {
      writeType = .withResponse
    } else {
      failConnectionSetup(
        self.error(.characteristicsMissing, "The printer Bluetooth write channel is not usable.")
      )
      return
    }

    guard
      notifyCharacteristic.properties.contains(.notify)
        || notifyCharacteristic.properties.contains(.indicate)
    else {
      failConnectionSetup(
        self.error(.characteristicsMissing, "The printer Bluetooth reply channel is not usable.")
      )
      return
    }

    phase = .enablingNotifications
    peripheral.setNotifyValue(true, for: notifyCharacteristic)
  }

  public func peripheral(
    _ peripheral: CBPeripheral,
    didUpdateNotificationStateFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    guard peripheral === self.peripheral, characteristic === notifyCharacteristic else { return }
    if phase == .closing {
      central.cancelPeripheralConnection(peripheral)
      return
    }
    guard phase == .enablingNotifications else { return }
    guard error == nil, characteristic.isNotifying else {
      failConnectionSetup(
        self.error(.notificationsFailed, "Could not enable printer Bluetooth replies.")
      )
      return
    }
    phase = .ready
    completeConnection()
    drainWrites()
  }

  public func peripheral(
    _ peripheral: CBPeripheral,
    didUpdateValueFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    guard peripheral === self.peripheral,
      characteristic === notifyCharacteristic,
      phase == .ready
    else { return }
    if error != nil {
      failSession(self.error(.disconnected, "Could not read the Bluetooth printer reply."))
      return
    }
    if let value = characteristic.value {
      receive(value)
    }
  }

  public func peripheral(
    _ peripheral: CBPeripheral,
    didWriteValueFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    guard peripheral === self.peripheral,
      characteristic === writeCharacteristic,
      writeType == .withResponse,
      writeAwaitingResponse
    else { return }

    writeAwaitingResponse = false
    if error != nil {
      writeInFlightLength = 0
      failSession(self.error(.writeFailed, "The Bluetooth printer write failed."))
      return
    }

    guard let request = writes.first else {
      writeInFlightLength = 0
      return
    }
    request.offset += writeInFlightLength
    writeInFlightLength = 0
    if request.offset == request.data.count {
      writes.removeFirst()
      request.continuation.resume()
    }
    drainWrites()
  }

  public func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
    guard peripheral === self.peripheral else { return }
    drainWrites()
  }

  private func failConnectionSetup(_ failure: MakeIDBluetoothError) {
    terminalError = failure
    failConnectionWaiter(failure)
    if let peripheral, peripheral.state != .disconnected {
      central.cancelPeripheralConnection(peripheral)
    }
    resetConnection(keepPeripheralUntilDisconnect: true)
  }
}
