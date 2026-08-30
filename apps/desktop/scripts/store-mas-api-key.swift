import Foundation
import Security

let service = "com.opendle.labelmaker.app-store-connect-api-key"
let arguments = Array(CommandLine.arguments.dropFirst())
let deleteSource = arguments.contains("--delete-source")
let paths = arguments.filter { $0 != "--delete-source" }

guard paths.count == 1, let sourcePath = paths.first else {
  fputs(
    "Use: store-mas-api-key.swift /path/to/AuthKey_<KEY_ID>.p8 [--delete-source]\n",
    stderr
  )
  exit(2)
}

let sourceUrl = URL(fileURLWithPath: sourcePath).standardizedFileURL
let fileName = sourceUrl.lastPathComponent
guard fileName.hasPrefix("AuthKey_"), fileName.hasSuffix(".p8") else {
  fputs("The key file name must be AuthKey_<KEY_ID>.p8.\n", stderr)
  exit(2)
}

let keyIdStart = fileName.index(fileName.startIndex, offsetBy: 8)
let keyIdEnd = fileName.index(fileName.endIndex, offsetBy: -3)
let keyId = String(fileName[keyIdStart..<keyIdEnd])
guard !keyId.isEmpty, keyId.allSatisfy({ $0.isLetter || $0.isNumber }) else {
  fputs("The App Store Connect API key ID is invalid.\n", stderr)
  exit(2)
}

let keyData: Data
do {
  keyData = try Data(contentsOf: sourceUrl, options: .mappedIfSafe)
} catch {
  fputs("Could not read the App Store Connect API key.\n", stderr)
  exit(1)
}

guard
  let pem = String(data: keyData, encoding: .utf8),
  pem.contains("-----BEGIN PRIVATE KEY-----"),
  pem.contains("-----END PRIVATE KEY-----")
else {
  fputs("The selected file is not an App Store Connect private key.\n", stderr)
  exit(2)
}

let baseQuery: [String: Any] = [
  kSecClass as String: kSecClassGenericPassword,
  kSecAttrService as String: service,
  kSecAttrAccount as String: keyId,
]
let attributes: [String: Any] = [
  kSecValueData as String: keyData,
  kSecAttrLabel as String: "Label Maker App Store Connect API key \(keyId)",
  kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked,
]

let updateStatus = SecItemUpdate(
  baseQuery as CFDictionary,
  attributes as CFDictionary
)
if updateStatus == errSecItemNotFound {
  let addQuery = baseQuery.merging(attributes) { _, new in new }
  let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
  guard addStatus == errSecSuccess else {
    failKeychainOperation("store", status: addStatus)
  }
} else if updateStatus != errSecSuccess {
  failKeychainOperation("update", status: updateStatus)
}

var readQuery = baseQuery
readQuery[kSecReturnData as String] = true
readQuery[kSecMatchLimit as String] = kSecMatchLimitOne
var storedValue: CFTypeRef?
let readStatus = SecItemCopyMatching(
  readQuery as CFDictionary,
  &storedValue
)
guard
  readStatus == errSecSuccess,
  let storedData = storedValue as? Data,
  storedData == keyData
else {
  failKeychainOperation("verify", status: readStatus)
}

if deleteSource {
  do {
    try FileManager.default.removeItem(at: sourceUrl)
  } catch {
    fputs(
      "The key is in Keychain, but the unencrypted source file could not be removed.\n",
      stderr
    )
    exit(1)
  }
}

print("Stored App Store Connect API key \(keyId) in the login Keychain.")
if deleteSource {
  print("Removed the verified unencrypted source file.")
}

func failKeychainOperation(_ operation: String, status: OSStatus) -> Never {
  let detail = SecCopyErrorMessageString(status, nil) as String? ?? "status \(status)"
  fputs("Could not \(operation) the API key in Keychain: \(detail).\n", stderr)
  exit(1)
}
