import Foundation

@MainActor
protocol BluetoothTransportHandling: AnyObject {
    func discover(timeoutMilliseconds: Int, completion: @escaping (Result<[[String: Any]], Error>) -> Void)
    func connect(deviceID: String, completion: @escaping (Result<String, Error>) -> Void)
    func write(connectionID: String, data: Data, completion: @escaping (Result<Void, Error>) -> Void)
    func read(connectionID: String, timeoutMilliseconds: Int, completion: @escaping (Result<Data, Error>) -> Void)
    func close(connectionID: String, completion: @escaping (Result<Void, Error>) -> Void)
}

enum BluetoothTransportError: LocalizedError {
    case unavailable

    var errorDescription: String? {
        "Bluetooth printer support is not available in this build."
    }
}

@MainActor
final class UnavailableBluetoothTransport: BluetoothTransportHandling {
    func discover(timeoutMilliseconds: Int, completion: @escaping (Result<[[String: Any]], Error>) -> Void) {
        completion(.failure(BluetoothTransportError.unavailable))
    }

    func connect(deviceID: String, completion: @escaping (Result<String, Error>) -> Void) {
        completion(.failure(BluetoothTransportError.unavailable))
    }

    func write(connectionID: String, data: Data, completion: @escaping (Result<Void, Error>) -> Void) {
        completion(.failure(BluetoothTransportError.unavailable))
    }

    func read(connectionID: String, timeoutMilliseconds: Int, completion: @escaping (Result<Data, Error>) -> Void) {
        completion(.failure(BluetoothTransportError.unavailable))
    }

    func close(connectionID: String, completion: @escaping (Result<Void, Error>) -> Void) {
        completion(.success(()))
    }
}

@MainActor
extension MakeIDBluetoothTransport: BluetoothTransportHandling {
    func discover(timeoutMilliseconds: Int, completion: @escaping (Result<[[String: Any]], Error>) -> Void) {
        Task {
            do {
                let devices = try await discover(timeoutMs: timeoutMilliseconds, includeUnpaired: true)
                completion(.success(devices.map { ["id": $0.id, "name": $0.name] }))
            } catch {
                completion(.failure(error))
            }
        }
    }

    func connect(deviceID: String, completion: @escaping (Result<String, Error>) -> Void) {
        Task {
            do {
                try await connect(deviceId: deviceID, timeoutMs: 10_000)
                completion(.success(deviceID))
            } catch {
                completion(.failure(error))
            }
        }
    }

    func write(connectionID: String, data: Data, completion: @escaping (Result<Void, Error>) -> Void) {
        Task {
            do {
                try await write(data)
                completion(.success(()))
            } catch {
                completion(.failure(error))
            }
        }
    }

    func read(connectionID: String, timeoutMilliseconds: Int, completion: @escaping (Result<Data, Error>) -> Void) {
        Task {
            do {
                completion(.success(try await read(timeoutMs: timeoutMilliseconds)))
            } catch {
                completion(.failure(error))
            }
        }
    }

    func close(connectionID: String, completion: @escaping (Result<Void, Error>) -> Void) {
        Task {
            await close()
            completion(.success(()))
        }
    }
}
