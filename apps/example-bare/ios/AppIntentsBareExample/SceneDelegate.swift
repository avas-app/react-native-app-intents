import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import ReactNativeAppIntents
import UIKit

class SceneDelegate: RCTDefaultReactNativeFactoryDelegate, UIWindowSceneDelegate {
  var window: UIWindow?
  var reactNativeFactory: RCTReactNativeFactory?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else {
      return
    }

    recordAppIntentsURLs(in: connectionOptions.urlContexts)

    if let shortcutItem = connectionOptions.shortcutItem {
      _ = handleShortcutItem(shortcutItem)
    }

    dependencyProvider = RCTAppDependencyProvider()
    reactNativeFactory = RCTReactNativeFactory(delegate: self)
    window = UIWindow(windowScene: windowScene)

    #if DEBUG
    reactNativeFactory?.devMenuConfiguration = RCTDevMenuConfiguration(
      devMenuEnabled: true,
      shakeGestureEnabled: true,
      keyboardShortcutsEnabled: true
    )
    #endif

    reactNativeFactory?.startReactNative(
      withModuleName: "AppIntentsBareExample",
      in: window,
      connectionOptions: connectionOptions
    )
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    recordAppIntentsURLs(in: URLContexts)
    RCTLinkingManager.scene(scene, openURLContexts: URLContexts)
  }

  func windowScene(
    _ windowScene: UIWindowScene,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    completionHandler(handleShortcutItem(shortcutItem))
  }

  private func recordAppIntentsURLs(in contexts: Set<UIOpenURLContext>) {
    for context in contexts where context.url.host == "app-intents" {
      ReactNativeAppIntents.recordIncomingURLString(context.url.absoluteString)
    }
  }

  private func handleShortcutItem(_ shortcutItem: UIApplicationShortcutItem) -> Bool {
    guard let url = shortcutItem.userInfo?["url"] as? String else {
      return false
    }

    ReactNativeAppIntents.recordIncomingURLString(url)
    return true
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    RCTLinkingManager.scene(scene, continue: userActivity)
  }

  override func bundleURL() -> URL? {
    #if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
    #else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    #endif
  }
}
