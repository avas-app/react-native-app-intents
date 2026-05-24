package com.reactnativeappintents

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import java.lang.ref.WeakReference
import java.security.MessageDigest
import java.util.ArrayDeque

class ReactNativeAppIntentsModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  init {
    reactContextRef = WeakReference(reactContext)
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun addListener(eventName: String) {
    // Required for RN NativeEventEmitter on Android; events emit via RCTDeviceEventEmitter.
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Required for RN NativeEventEmitter on Android; events emit via RCTDeviceEventEmitter.
  }

  @ReactMethod
  fun donate(
    intentId: String,
    title: String,
    url: String,
    payload: String,
    capabilityBindings: ReadableArray?,
    promise: Promise,
  ) {
    try {
      val shortcutId = createDonationShortcutId(intentId, payload)
      val shortcut = createShortcut(
        shortcutId,
        title,
        null,
        url,
        reactApplicationContext.packageName,
        null,
        readCapabilityBindings(capabilityBindings),
        true,
      )

      if (!ShortcutManagerCompat.pushDynamicShortcut(reactApplicationContext, shortcut)) {
        promise.reject(
          "donate_failed",
          "Android did not accept the donated shortcut. Shortcut publishing may be rate-limited.",
        )
        return
      }

      saveShortcutId(DONATION_SHORTCUT_IDS_KEY, shortcutId)
      ShortcutManagerCompat.reportShortcutUsed(reactApplicationContext, shortcutId)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("donate_failed", "Failed to donate intent.", error)
    }
  }

  @ReactMethod
  fun clearDonations(promise: Promise) {
    try {
      val shortcutIds = getShortcutIds(DONATION_SHORTCUT_IDS_KEY).toList()

      if (shortcutIds.isNotEmpty()) {
        ShortcutManagerCompat.removeDynamicShortcuts(reactApplicationContext, shortcutIds)
        ShortcutManagerCompat.removeLongLivedShortcuts(reactApplicationContext, shortcutIds)
      }

      clearShortcutIds(DONATION_SHORTCUT_IDS_KEY)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("clear_donations_failed", "Failed to clear donated shortcuts.", error)
    }
  }

  @ReactMethod
  fun getInitialIntentURL(promise: Promise) {
    val currentUrl = if (pendingUrls.isEmpty()) null else pendingUrls.removeFirst()
    promise.resolve(currentUrl)
  }

  @ReactMethod
  fun updateDynamicShortcuts(shortcuts: ReadableArray, promise: Promise) {
    val packageName = reactApplicationContext.packageName
    val shortcutList = mutableListOf<ShortcutInfoCompat>()

    for (index in 0 until shortcuts.size()) {
      val shortcut = shortcuts.getMap(index) ?: continue
      shortcutList.add(createShortcut(shortcut, packageName))
    }

    val previousShortcutIds = getShortcutIds(DYNAMIC_SHORTCUT_IDS_KEY).toList()
    if (previousShortcutIds.isNotEmpty()) {
      ShortcutManagerCompat.removeDynamicShortcuts(reactApplicationContext, previousShortcutIds)
    }

    ShortcutManagerCompat.addDynamicShortcuts(reactApplicationContext, shortcutList)
    setShortcutIds(DYNAMIC_SHORTCUT_IDS_KEY, shortcutList.map { it.id }.toSet())
    promise.resolve(null)
  }

  private fun createShortcut(
    shortcut: ReadableMap,
    packageName: String,
  ): ShortcutInfoCompat {
    val shortcutId = shortcut.getString("id") ?: error("Shortcut id is required.")
    val title = shortcut.getString("title") ?: shortcutId
    val subtitle = shortcut.getString("subtitle")
    val url = shortcut.getString("url") ?: error("Shortcut url is required.")
    val iconResourceName = shortcut.getMap("icon")?.getString("androidResourceName")
    val capabilityBindings = readCapabilityBindings(shortcut.getArray("capabilityBindings"))

    return createShortcut(
      shortcutId,
      title,
      subtitle,
      url,
      packageName,
      iconResourceName,
      capabilityBindings,
      false,
    )
  }

  private fun createShortcut(
    shortcutId: String,
    title: String,
    subtitle: String?,
    url: String,
    packageName: String,
    iconResourceName: String?,
    capabilityBindings: List<ShortcutCapabilityBinding>,
    longLived: Boolean,
  ): ShortcutInfoCompat {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
      reactApplicationContext.packageManager.getLaunchIntentForPackage(packageName)?.component?.let {
        component = it
      } ?: setPackage(packageName)
      addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }

    val builder = ShortcutInfoCompat.Builder(reactApplicationContext, shortcutId)
      .setShortLabel(title)
      .setIntent(intent)
      .setIcon(
        IconCompat.createWithResource(
          reactApplicationContext,
          resolveShortcutIconResourceId(iconResourceName) ?: getDefaultShortcutIconResourceId(),
        ),
      )

    if (subtitle != null) {
      builder.setLongLabel(subtitle)
    }

    if (longLived) {
      builder.setLongLived(true)
    }

    applyCapabilityBindings(builder, capabilityBindings)

    return builder.build()
  }

  private fun readCapabilityBindings(capabilityBindings: ReadableArray?): List<ShortcutCapabilityBinding> {
    if (capabilityBindings == null) {
      return emptyList()
    }

    val bindings = mutableListOf<ShortcutCapabilityBinding>()

    for (bindingIndex in 0 until capabilityBindings.size()) {
      val binding = capabilityBindings.getMap(bindingIndex) ?: continue
      val capabilityName = binding.getString("capabilityName") ?: continue
      val parameterBindings = mutableListOf<ShortcutCapabilityParameterBinding>()
      val parameterBindingArray = binding.getArray("parameterBindings")

      if (parameterBindingArray != null) {
        for (parameterIndex in 0 until parameterBindingArray.size()) {
          val parameterBinding = parameterBindingArray.getMap(parameterIndex) ?: continue
          val key = parameterBinding.getString("key") ?: continue
          val value = parameterBinding.getString("value") ?: continue
          parameterBindings.add(ShortcutCapabilityParameterBinding(key, value))
        }
      }

      bindings.add(ShortcutCapabilityBinding(capabilityName, parameterBindings))
    }

    return bindings
  }

  private fun applyCapabilityBindings(
    builder: ShortcutInfoCompat.Builder,
    capabilityBindings: List<ShortcutCapabilityBinding>,
  ) {
    for (capabilityBinding in capabilityBindings) {
      if (capabilityBinding.parameterBindings.isEmpty()) {
        builder.addCapabilityBinding(capabilityBinding.capabilityName)
        continue
      }

      for (parameterBinding in capabilityBinding.parameterBindings) {
        builder.addCapabilityBinding(
          capabilityBinding.capabilityName,
          parameterBinding.key,
          listOf(parameterBinding.value),
        )
      }
    }
  }

  private fun getDefaultShortcutIconResourceId(): Int =
    reactApplicationContext.applicationInfo.icon.takeIf { it != 0 } ?: android.R.mipmap.sym_def_app_icon

  private fun resolveShortcutIconResourceId(iconResourceName: String?): Int? {
    if (iconResourceName == null) {
      return null
    }

    val match = ANDROID_SHORTCUT_ICON_PATTERN.matchEntire(iconResourceName)
      ?: error("""Android shortcut icons must look like "@drawable/name" or "@mipmap/name".""")
    val resourceType = match.groupValues[1]
    val resourceName = match.groupValues[2]
    val resourceId = reactApplicationContext.resources.getIdentifier(
      resourceName,
      resourceType,
      reactApplicationContext.packageName,
    )

    if (resourceId == 0) {
      error("""Android shortcut icon resource "$iconResourceName" was not found.""")
    }

    return resourceId
  }

  private fun getShortcutIds(key: String): Set<String> =
    preferences.getStringSet(key, emptySet())?.toSet() ?: emptySet()

  private fun setShortcutIds(key: String, shortcutIds: Set<String>) {
    preferences.edit().putStringSet(key, shortcutIds).apply()
  }

  private fun saveShortcutId(key: String, shortcutId: String) {
    setShortcutIds(key, getShortcutIds(key) + shortcutId)
  }

  private fun clearShortcutIds(key: String) {
    preferences.edit().remove(key).apply()
  }

  private val preferences: SharedPreferences
    get() = reactApplicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  companion object {
    const val NAME = "ReactNativeAppIntents"
    private const val DONATION_SHORTCUT_PREFIX = "react-native-app-intents-donation"
    private const val DONATION_SHORTCUT_IDS_KEY = "donationShortcutIds"
    private const val DYNAMIC_SHORTCUT_IDS_KEY = "dynamicShortcutIds"
    private const val PREFERENCES_NAME = "ReactNativeAppIntents"
    private val ANDROID_SHORTCUT_ICON_PATTERN = Regex("^@(drawable|mipmap)/([A-Za-z0-9_]+)$")
    private val pendingUrls = ArrayDeque<String>()
    private var reactContextRef: WeakReference<ReactApplicationContext>? = null

    fun handleIntent(intent: Intent?) {
      val uri = intent?.data ?: return

      if (uri.host != "app-intents") {
        return
      }

      handleUrl(uri.toString())
    }

    private fun handleUrl(url: String?) {
      if (url == null) {
        return
      }

      pendingUrls.addLast(url)

      val reactContext = reactContextRef?.get() ?: return
      val payload = com.facebook.react.bridge.Arguments.createMap().apply {
        putString("url", url)
      }
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("appIntentUrl", payload)
    }

    private fun createDonationShortcutId(intentId: String, payload: String): String {
      val digest = MessageDigest
        .getInstance("SHA-256")
        .digest("$intentId:$payload".toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it.toInt() and 0xff) }

      return "$DONATION_SHORTCUT_PREFIX:$digest"
    }
  }

  private data class ShortcutCapabilityBinding(
    val capabilityName: String,
    val parameterBindings: List<ShortcutCapabilityParameterBinding>,
  )

  private data class ShortcutCapabilityParameterBinding(
    val key: String,
    val value: String,
  )
}
