import AppIntents
import Foundation

private let reactNativeAppIntentsAppGroupInfoKey = "ReactNativeAppIntentsAppGroupIdentifier"
private let reactNativeAppIntentsAppGroupIdentifier: String? = "group.com.avasapp.appintents.example"
private let reactNativeAppIntentsPendingURLsKey = "ReactNativeAppIntentsPendingURLs"
private func reactNativeAppIntentsUserDefaults() -> UserDefaults {
  if let suiteName = reactNativeAppIntentsAppGroupIdentifier,
     let sharedDefaults = UserDefaults(suiteName: suiteName) {
    return sharedDefaults
  }

  if let suiteName = Bundle.main.object(forInfoDictionaryKey: reactNativeAppIntentsAppGroupInfoKey) as? String,
     let sharedDefaults = UserDefaults(suiteName: suiteName) {
    return sharedDefaults
  }

  return UserDefaults.standard
}
private func enqueueReactNativeAppIntentURL(_ url: URL) {
  let defaults = reactNativeAppIntentsUserDefaults()
  var pendingUrls = defaults.stringArray(forKey: reactNativeAppIntentsPendingURLsKey) ?? []
  pendingUrls.append(url.absoluteString)
  defaults.set(pendingUrls, forKey: reactNativeAppIntentsPendingURLsKey)
  defaults.synchronize()
}

private func encodeReactNativeAppIntentsJSONValue<T: Encodable>(_ value: T) throws -> String {
  let encoder = JSONEncoder()
  encoder.dateEncodingStrategy = .iso8601
  let data = try encoder.encode(value)
  return String(decoding: data, as: UTF8.self)
}

@available(iOS 16.0, *)
struct OrderAppEntity: AppEntity {
  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Order")
  static let defaultQuery = OrderEntityQuery()

  let id: String

  var displayRepresentation: DisplayRepresentation {
    OrderEntityCatalog.displayRepresentation(for: id)
  }
}

@available(iOS 16.0, *)
private struct OrderEntityRecord {
  let id: String
  let displayRepresentation: DisplayRepresentation
  let jsonValue: String
  let searchText: String
}

@available(iOS 16.0, *)
private enum OrderEntityCatalog {
  static let records: [OrderEntityRecord] = [
    OrderEntityRecord(
      id: "1",
      displayRepresentation: DisplayRepresentation(title: "Order #1234", subtitle: "Taylor", image: DisplayRepresentation.Image(systemName: "bag")),
      jsonValue: "{\"id\":1,\"number\":\"1234\",\"customer\":\"Taylor\"}",
      searchText: "1 Order #1234 Taylor"
    ),
  ]
  static let recordsById: [String: OrderEntityRecord] = Dictionary(uniqueKeysWithValues: records.map { ($0.id, $0) })
  static let allEntities: [OrderAppEntity] = records.map { OrderAppEntity(id: $0.id) }

  static func displayRepresentation(for id: String) -> DisplayRepresentation {
    recordsById[id]?.displayRepresentation ?? DisplayRepresentation(title: "Unknown")
  }

  static func jsonValue(for id: String) throws -> String {
    guard let record = recordsById[id] else {
      throw NSError(
        domain: "ReactNativeAppIntents",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "Could not resolve App Entity payload."]
      )
    }

    return record.jsonValue
  }

  static func entities(for identifiers: [String]) -> [OrderAppEntity] {
    identifiers.compactMap { recordsById[$0].map { OrderAppEntity(id: $0.id) } }
  }

  static func search(matching query: String) -> [OrderAppEntity] {
    if query.isEmpty {
      return allEntities
    }

    let normalizedQuery = query.lowercased()

    return records
      .filter { $0.searchText.lowercased().contains(normalizedQuery) }
      .map { OrderAppEntity(id: $0.id) }
  }
}

@available(iOS 16.0, *)
struct OrderEntityQuery: EntityQuery, EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [OrderAppEntity] {
    OrderEntityCatalog.entities(for: identifiers)
  }

  func suggestedEntities() async throws -> [OrderAppEntity] {
    OrderEntityCatalog.allEntities
  }

  func entities(matching string: String) async throws -> [OrderAppEntity] {
    OrderEntityCatalog.search(matching: string)
  }
}

@available(iOS 16.0, *)
struct OpenOrderIntent: AppIntent {
  static let title: LocalizedStringResource = "Open Order"
  static let description = IntentDescription("Open a specific order by number.")
  static let openAppWhenRun = true

  @Parameter(
    title: "Order number",
    requestValueDialog: IntentDialog("What's the order number?")
  )
  var orderNumber: String

  func perform() async throws -> some IntentResult {
    let payloadEntries = [
      "\"orderNumber\": \(try encodeReactNativeAppIntentsJSONValue(orderNumber))",
    ]
    let payloadString = "{\(payloadEntries.joined(separator: ","))}"
    var components = URLComponents()
    components.scheme = "example"
    components.host = "app-intents"
    components.path = "/openOrder"
    components.queryItems = [URLQueryItem(name: "payload", value: payloadString)]

    guard let url = components.url else {
      throw NSError(
        domain: "ReactNativeAppIntents",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Could not create app-intents URL."]
      )
    }

    enqueueReactNativeAppIntentURL(url)
    return .result()
  }
}

@available(iOS 16.0, *)
struct OpenSavedOrderIntent: AppIntent {
  static let title: LocalizedStringResource = "Open Saved Order"
  static let description = IntentDescription("Open a saved order from inventory.")
  static let openAppWhenRun = true

  @Parameter(
    title: "Order",
    requestValueDialog: IntentDialog("Which order?")
  )
  var order: OrderAppEntity

  func perform() async throws -> some IntentResult {
    let payloadEntries = [
      "\"order\": \(try OrderEntityCatalog.jsonValue(for: order.id))",
    ]
    let payloadString = "{\(payloadEntries.joined(separator: ","))}"
    var components = URLComponents()
    components.scheme = "example"
    components.host = "app-intents"
    components.path = "/openSavedOrder"
    components.queryItems = [URLQueryItem(name: "payload", value: payloadString)]

    guard let url = components.url else {
      throw NSError(
        domain: "ReactNativeAppIntents",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Could not create app-intents URL."]
      )
    }

    enqueueReactNativeAppIntentURL(url)
    return .result()
  }
}

@available(iOS 16.0, *)
struct ExampleAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    return [
      AppShortcut(
        intent: OpenOrderIntent(),
        phrases: [
          "Open order in \(.applicationName)",
          "Show my order in \(.applicationName)",
        ],
        shortTitle: "Open Order",
        systemImageName: "shippingbox"
      ),
      AppShortcut(
        intent: OpenSavedOrderIntent(),
        phrases: [
          "Open \(\.$order) in \(.applicationName)",
          "Show \(\.$order) in \(.applicationName)",
        ],
        shortTitle: "Open Saved Order",
        systemImageName: "square.grid.2x2"
      ),
    ]
  }
}
