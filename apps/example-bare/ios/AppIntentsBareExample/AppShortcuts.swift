import AppIntents
import CoreSpotlight
import Foundation
import UIKit
import os

let dbgLog = Logger(subsystem: "dbg.spot", category: "sync")

@available(iOS 18.0, *)
func dbgListIndex(_ tag: String) {
  let q = CSSearchQuery(queryString: "displayName == \"*\"wc", queryContext: nil)
  var found: [String] = []
  q.foundItemsHandler = { items in found += items.map { $0.uniqueIdentifier } }
  q.completionHandler = { err in dbgLog.notice("DBG \(tag, privacy: .public) index holds \(found.joined(separator: ","), privacy: .public) err=\(String(describing: err), privacy: .public)") }
  q.start()
}

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
  guard
    let invocationId = URLComponents(url: url, resolvingAgainstBaseURL: false)?
      .queryItems?.first(where: { $0.name == "invocationId" })?.value,
    !invocationId.isEmpty
  else {
    return
  }

  let defaults = reactNativeAppIntentsUserDefaults()
  defaults.set(
    ["url": url.absoluteString, "createdAt": Date().timeIntervalSince1970],
    forKey: "\(reactNativeAppIntentsPendingURLsKey).\(invocationId)"
  )
  defaults.synchronize()
  NotificationCenter.default.post(name: Notification.Name("ReactNativeAppIntentsDidEnqueue"), object: nil)
}

private func reactNativeAppIntentsJSONObject<T: Encodable>(_ value: T) throws -> Any {
  let encoder = JSONEncoder()
  encoder.dateEncodingStrategy = .iso8601
  let data = try encoder.encode(value)
  return try JSONSerialization.jsonObject(with: data)
}

private func reactNativeAppIntentsJSONObject(fromJSONString json: String) throws -> Any {
  let data = Data(json.utf8)
  return try JSONSerialization.jsonObject(with: data)
}

private func reactNativeAppIntentsJSONString(_ payload: [String: Any]) throws -> String {
  let data = try JSONSerialization.data(withJSONObject: payload)
  return String(decoding: data, as: UTF8.self)
}

private struct ReactNativeAppIntentsCatalogEntry {
  let id: String
  let title: String
  let subtitle: String?
  let synonyms: [String]
  let jsonValue: String
  let hideInSpotlight: Bool
  let fingerprint: String
}

private final class ReactNativeAppIntentsCatalogCache: @unchecked Sendable {
  static let shared = ReactNativeAppIntentsCatalogCache()

  private let lock = NSLock()
  private var cache: [String: (json: String, entries: [ReactNativeAppIntentsCatalogEntry]?)] = [:]

  func entries(forKey key: String, json: String) -> [ReactNativeAppIntentsCatalogEntry]? {
    lock.lock()
    defer { lock.unlock() }

    if let cached = cache[key], cached.json == json {
      return cached.entries
    }

    let entries = reactNativeAppIntentsParseCatalog(json)
    cache[key] = (json, entries)
    return entries
  }
}

private func reactNativeAppIntentsCatalogEntries(forKey key: String) -> [ReactNativeAppIntentsCatalogEntry]? {
  guard let json = reactNativeAppIntentsUserDefaults().string(forKey: key) else {
    return nil
  }

  return ReactNativeAppIntentsCatalogCache.shared.entries(forKey: key, json: json)
}

private func reactNativeAppIntentsParseCatalog(_ json: String) -> [ReactNativeAppIntentsCatalogEntry]? {
  guard let items = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[String: Any]] else {
    return nil
  }

  return items.compactMap { item in
    guard
      let id = item["id"] as? String, !id.isEmpty,
      let title = item["title"] as? String,
      let value = item["value"],
      let valueData = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
      let itemData = try? JSONSerialization.data(withJSONObject: item, options: [.sortedKeys])
    else {
      return nil
    }

    return ReactNativeAppIntentsCatalogEntry(
      id: id,
      title: title,
      subtitle: item["subtitle"] as? String,
      synonyms: (item["synonyms"] as? [String]) ?? [],
      jsonValue: String(decoding: valueData, as: UTF8.self),
      hideInSpotlight: (item["hideInSpotlight"] as? Bool) ?? false,
      fingerprint: String(decoding: itemData, as: UTF8.self)
    )
  }
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

@available(iOS 18.0, *)
extension OrderAppEntity: IndexedEntity {
  var hideInSpotlight: Bool {
    OrderEntityCatalog.record(for: id)?.hideInSpotlight ?? true
  }

  var attributeSet: CSSearchableItemAttributeSet {
    let attributes = defaultAttributeSet
    if let record = OrderEntityCatalog.record(for: id) {
      attributes.displayName = record.title
      attributes.contentDescription = record.subtitle
      attributes.keywords = record.synonyms
    }
    return attributes
  }
}

@available(iOS 16.0, *)
private struct OrderEntityRecord {
  let id: String
  let displayRepresentation: DisplayRepresentation
  let jsonValue: String
  let searchText: String
  let hideInSpotlight: Bool
  let fingerprint: String
  let title: String
  let subtitle: String?
  let synonyms: [String]

  init(
    id: String,
    displayRepresentation: DisplayRepresentation,
    jsonValue: String,
    searchText: String,
    hideInSpotlight: Bool,
    title: String,
    subtitle: String?,
    fingerprint: String
  ) {
    self.id = id
    self.displayRepresentation = displayRepresentation
    self.jsonValue = jsonValue
    self.searchText = searchText
    self.hideInSpotlight = hideInSpotlight
    self.title = title
    self.subtitle = subtitle
    self.synonyms = []
    self.fingerprint = fingerprint
  }

  init(entry: ReactNativeAppIntentsCatalogEntry) {
    self.id = entry.id
    self.title = entry.title
    self.subtitle = entry.subtitle
    self.synonyms = entry.synonyms
    self.displayRepresentation = DisplayRepresentation(
      title: LocalizedStringResource(stringLiteral: entry.title),
      subtitle: entry.subtitle.map { LocalizedStringResource(stringLiteral: $0) }
    )
    self.jsonValue = entry.jsonValue
    self.searchText = ([entry.id, entry.title] + [entry.subtitle].compactMap { $0 } + entry.synonyms).joined(separator: " ")
    self.hideInSpotlight = entry.hideInSpotlight
    self.fingerprint = entry.fingerprint
  }
}

@available(iOS 16.0, *)
private enum OrderEntityCatalog {
  static let storeKey = "ReactNativeAppIntentsEntityCatalog.Order"
  static let indexedKey = "ReactNativeAppIntentsIndexedEntities.Order"
  static let seedRecords: [OrderEntityRecord] = [
    OrderEntityRecord(
      id: "1",
      displayRepresentation: DisplayRepresentation(title: "Order #1234", subtitle: "Taylor", image: DisplayRepresentation.Image(systemName: "bag")),
      jsonValue: "{\"id\":1,\"number\":\"1234\",\"customer\":\"Taylor\"}",
      searchText: "1 Order #1234 Taylor",
      hideInSpotlight: false,
      title: "Order #1234",
      subtitle: "Taylor",
      fingerprint: "[\"1\",{\"imageSystemName\":\"bag\",\"subtitle\":\"Taylor\",\"title\":\"Order #1234\"},\"{\\\"id\\\":1,\\\"number\\\":\\\"1234\\\",\\\"customer\\\":\\\"Taylor\\\"}\"]"
    ),
  ]

  static var records: [OrderEntityRecord] {
    reactNativeAppIntentsCatalogEntries(forKey: storeKey)?.map { OrderEntityRecord(entry: $0) } ?? seedRecords
  }

  static func record(for id: String) -> OrderEntityRecord? {
    guard let entries = reactNativeAppIntentsCatalogEntries(forKey: storeKey) else {
      return seedRecords.first { $0.id == id }
    }

    return entries.first { $0.id == id }.map { OrderEntityRecord(entry: $0) }
  }

  static func displayRepresentation(for id: String) -> DisplayRepresentation {
    record(for: id)?.displayRepresentation ?? DisplayRepresentation(title: "Unknown")
  }

  static func jsonValue(for id: String) throws -> String {
    guard let record = record(for: id) else {
      throw NSError(
        domain: "ReactNativeAppIntents",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "Could not resolve App Entity payload."]
      )
    }

    return record.jsonValue
  }

  static func entities(for identifiers: [String]) -> [OrderAppEntity] {
    let all = records
    return identifiers.compactMap { id in all.first { $0.id == id }.map { OrderAppEntity(id: $0.id) } }
  }

  static func search(matching query: String) -> [OrderAppEntity] {
    let all = records

    if query.isEmpty {
      return all.map { OrderAppEntity(id: $0.id) }
    }

    let normalizedQuery = query.lowercased()

    return all
      .filter { $0.searchText.lowercased().contains(normalizedQuery) }
      .map { OrderAppEntity(id: $0.id) }
  }
}

@available(iOS 18.0, *)
extension OrderEntityCatalog {
  static func syncSpotlight(rebuild: Bool) async throws {
    let defaults = reactNativeAppIntentsUserDefaults()
    let index = CSSearchableIndex.default()
    let visible = records.filter { !$0.hideInSpotlight }
    let previous = rebuild ? [:] : (defaults.dictionary(forKey: indexedKey) as? [String: String] ?? [:])

    if rebuild {
      try await index.deleteAppEntities(ofType: OrderAppEntity.self)
    }

    dbgLog.notice("DBG sync rebuild=\(rebuild, privacy: .public) previous=\(previous.keys.sorted().joined(separator: ","), privacy: .public) visible=\(visible.map { $0.id }.joined(separator: ","), privacy: .public)")
    let current = Dictionary(visible.map { ($0.id, $0.fingerprint) }, uniquingKeysWith: { first, _ in first })
    let removed = previous.keys.filter { current[$0] == nil }

    if !removed.isEmpty {
      try await index.deleteAppEntities(identifiedBy: Array(removed), ofType: OrderAppEntity.self)
    }

    let changed = visible.filter { previous[$0.id] != $0.fingerprint }

    if !changed.isEmpty {
      try await index.indexAppEntities(changed.map { OrderAppEntity(id: $0.id) }, priority: 0)
    }

    dbgLog.notice("DBG sync done removed=\(removed.joined(separator: ","), privacy: .public) changed=\(changed.map { $0.id }.joined(separator: ","), privacy: .public)")
    defaults.set(current, forKey: indexedKey)
    try? await Task.sleep(nanoseconds: 3_000_000_000)
    if #available(iOS 18.0, *) { dbgListIndex("after-sync") }
  }
}

@available(iOS 16.0, *)
struct OrderEntityQuery: EntityQuery, EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [OrderAppEntity] {
    OrderEntityCatalog.entities(for: identifiers)
  }

  func suggestedEntities() async throws -> [OrderAppEntity] {
    OrderEntityCatalog.search(matching: "")
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

  static var parameterSummary: some ParameterSummary {
    Summary("Open Order \(\.$orderNumber)")
  }

  @Parameter(
    title: "Order number",
    requestValueDialog: IntentDialog("What's the order number?")
  )
  var orderNumber: String

  func perform() async throws -> some IntentResult {
    var payload: [String: Any] = [:]
    payload["orderNumber"] = try reactNativeAppIntentsJSONObject(orderNumber)
    let payloadString = try reactNativeAppIntentsJSONString(payload)
    var components = URLComponents()
    components.scheme = "example"
    components.host = "app-intents"
    components.path = "/openOrder"
    components.queryItems = [
      URLQueryItem(name: "payload", value: payloadString),
      URLQueryItem(name: "invocationId", value: UUID().uuidString),
    ]

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
struct OpenSavedOrderIntent: AppIntent, OpenIntent {
  static let title: LocalizedStringResource = "Open Saved Order"
  static let description = IntentDescription("Open a saved order from inventory.")
  static let openAppWhenRun = true

  static var parameterSummary: some ParameterSummary {
    Summary("Open Saved Order \(\.$target)")
  }

  @Parameter(
    title: "Order",
    requestValueDialog: IntentDialog("Which order?")
  )
  var target: OrderAppEntity

  func perform() async throws -> some IntentResult {
    var payload: [String: Any] = [:]
    payload["order"] = try reactNativeAppIntentsJSONObject(fromJSONString: try OrderEntityCatalog.jsonValue(for: target.id))
    let payloadString = try reactNativeAppIntentsJSONString(payload)
    var components = URLComponents()
    components.scheme = "example"
    components.host = "app-intents"
    components.path = "/openSavedOrder"
    components.queryItems = [
      URLQueryItem(name: "payload", value: payloadString),
      URLQueryItem(name: "invocationId", value: UUID().uuidString),
    ]

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
          "Open \(\.$target) in \(.applicationName)",
          "Show \(\.$target) in \(.applicationName)",
        ],
        shortTitle: "Open Saved Order",
        systemImageName: "square.grid.2x2"
      ),
    ]
  }
}

@available(iOS 18.0, *)
private final class ReactNativeAppIntentsIndexDelegate: NSObject, CSSearchableIndexDelegate {
  static let shared = ReactNativeAppIntentsIndexDelegate()

  static func install() {
    CSSearchableIndex.default().indexDelegate = shared
  }

  func searchableIndex(
    _ searchableIndex: CSSearchableIndex,
    reindexAllSearchableItemsWithAcknowledgementHandler acknowledgementHandler: @escaping () -> Void
  ) {
    dbgLog.notice("DBG delegate reindex called")
    Task {
      try? await ReactNativeAppIntentsGeneratedBridge.syncCatalog(entityId: nil, rebuild: true)
      acknowledgementHandler()
    }
  }

  func searchableIndex(
    _ searchableIndex: CSSearchableIndex,
    reindexSearchableItemsWithIdentifiers identifiers: [String],
    acknowledgementHandler: @escaping () -> Void
  ) {
    dbgLog.notice("DBG delegate reindex called")
    Task {
      try? await ReactNativeAppIntentsGeneratedBridge.syncCatalog(entityId: nil, rebuild: true)
      acknowledgementHandler()
    }
  }
}

private actor ReactNativeAppIntentsSyncGate {
  private var busy = false
  private var waiters: [CheckedContinuation<Void, Never>] = []

  func acquire() async {
    if busy {
      await withCheckedContinuation { waiters.append($0) }
    } else {
      busy = true
    }
  }

  func release() {
    if waiters.isEmpty {
      busy = false
    } else {
      waiters.removeFirst().resume()
    }
  }
}

@available(iOS 16.0, *)
private func reactNativeAppIntentsEntityIdentifier(_ entityId: String, _ id: String) -> EntityIdentifier? {
  switch entityId {
  case "Order":
    return EntityIdentifier(for: OrderAppEntity.self, identifier: id)
  default:
    return nil
  }
}

@objc(ReactNativeAppIntentsGeneratedBridge)
final class ReactNativeAppIntentsGeneratedBridge: NSObject {
  @objc static func catalogDidChange(_ entityId: String, completion: @escaping (NSError?) -> Void) {
    Task {
      do {
        try await syncCatalog(entityId: entityId, rebuild: false)
        completion(nil)
      } catch {
        completion(error as NSError)
      }
    }
  }

  @objc static func reindex(_ entityId: String?, completion: @escaping (NSError?) -> Void) {
    Task {
      do {
        try await syncCatalog(entityId: entityId, rebuild: true)
        completion(nil)
      } catch {
        completion(error as NSError)
      }
    }
  }

  private static let syncGate = ReactNativeAppIntentsSyncGate()
  nonisolated(unsafe) private static var onscreenOwners: [(token: String, entityId: String, id: String)] = []

  fileprivate static func syncCatalog(entityId: String?, rebuild: Bool) async throws {
    await syncGate.acquire()

    do {
      try await syncCatalogUnlocked(entityId: entityId, rebuild: rebuild)
      await syncGate.release()
    } catch {
      await syncGate.release()
      throw error
    }
  }

  private static func syncCatalogUnlocked(entityId: String?, rebuild: Bool) async throws {
    if #available(iOS 18.0, *) {
      ReactNativeAppIntentsIndexDelegate.install()

      for id in ["Order"] where entityId == nil || entityId == id {
        switch id {
        case "Order":
          try await OrderEntityCatalog.syncSpotlight(rebuild: rebuild)
        default:
          break
        }
      }
    }

    if #available(iOS 16.0, *) {
      ExampleAppShortcuts.updateAppShortcutParameters()
    }
  }

  @objc static func start() {
    if #available(iOS 18.0, *) {
      ReactNativeAppIntentsIndexDelegate.install()
    }
  }

  @objc static func setOnscreenEntity(_ token: String, entityId: String?, id: String?) {
    DispatchQueue.main.async {
      onscreenOwners.removeAll { $0.token == token }

      if let entityId, let id {
        onscreenOwners.append((token: token, entityId: entityId, id: id))
      }

      guard #available(iOS 18.2, *) else {
        return
      }

      let root = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap { $0.windows }
        .first { $0.isKeyWindow }?
        .rootViewController

      guard let root else {
        return
      }

      if let owner = onscreenOwners.last, let identifier = reactNativeAppIntentsEntityIdentifier(owner.entityId, owner.id) {
        let activity = NSUserActivity(activityType: "ReactNativeAppIntents.onscreenEntity")
        activity.appEntityIdentifier = identifier
        root.userActivity = activity
        activity.becomeCurrent()
      } else if let activity = root.userActivity {
        activity.appEntityIdentifier = nil
        activity.resignCurrent()
        root.userActivity = nil
      }
    }
  }

  @objc static func setEntityIdentifier(on view: UIView, entityId: String?, id: String?) {
    DispatchQueue.main.async {
      guard #available(iOS 18.4, *) else {
        return
      }

      if let entityId, let id {
        view.appEntityIdentifier = reactNativeAppIntentsEntityIdentifier(entityId, id)
      } else {
        view.appEntityIdentifier = nil
      }
    }
  }
}
