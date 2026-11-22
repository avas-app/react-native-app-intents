import UIKit
import AppIntents
import React
import ReactNativeAppIntents

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    if #available(iOS 16.0, *) {
      ExampleAppShortcuts.updateAppShortcutParameters()
    }

    if let shortcutItem = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem,
       handleShortcutItem(shortcutItem) {
      return false
    }

    return true
  }

  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey : Any] = [:]
  ) -> Bool {
    if url.host == "app-intents" {
      ReactNativeAppIntents.recordIncomingURLString(url.absoluteString)
    }

    return RCTLinkingManager.application(app, open: url, options: options)
  }

  func application(
    _ application: UIApplication,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    completionHandler(handleShortcutItem(shortcutItem))
  }

  private func handleShortcutItem(_ shortcutItem: UIApplicationShortcutItem) -> Bool {
    guard let url = shortcutItem.userInfo?["url"] as? String else {
      return false
    }

    ReactNativeAppIntents.recordIncomingURLString(url)
    return true
  }
}
