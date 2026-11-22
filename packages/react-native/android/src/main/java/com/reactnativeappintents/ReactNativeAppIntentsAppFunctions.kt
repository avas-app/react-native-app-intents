package com.reactnativeappintents

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import java.util.UUID

/** Entry point for generated AppFunction code. Has no androidx.appfunctions dependency. */
object ReactNativeAppIntentsAppFunctions {
  private const val TAG = "ReactNativeAppIntents"

  // The JS runtime accepts this scheme next to the app's own; native doesn't know the app's scheme.
  private const val URL_SCHEME = "app-intents-function"

  @JvmStatic
  fun deliver(
    context: Context,
    intentId: String,
    payloadJson: String,
    opensAppToForeground: Boolean,
  ): String {
    val invocationId = UUID.randomUUID().toString()
    val uri = Uri.Builder()
      .scheme(URL_SCHEME)
      .authority("app-intents")
      .appendPath(intentId)
      .appendQueryParameter("payload", payloadJson)
      .appendQueryParameter("invocationId", invocationId)
      .build()
    val intent = Intent(Intent.ACTION_VIEW, uri).setPackage(context.packageName)

    ReactNativeAppIntentsModule.handleIntent(intent)

    if (opensAppToForeground) {
      try {
        context.startActivity(
          Intent(intent).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
      } catch (error: Exception) {
        // A blocked background launch leaves the call queued; the user sees it on next open.
        Log.w(TAG, "AppFunction could not open the app; the call stays queued.", error)
      }
    }

    return invocationId
  }
}
