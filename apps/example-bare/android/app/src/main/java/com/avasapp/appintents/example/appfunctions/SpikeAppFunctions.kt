package com.avasapp.appintents.example.appfunctions

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.appfunctions.AppFunctionSerializable
import androidx.appfunctions.AppFunctionDeclaration
import androidx.appfunctions.AppFunctionServiceEntryPoint
import androidx.appfunctions.AppFunctionService
import com.reactnativeappintents.ReactNativeAppIntentsModule
import java.util.UUID

@AppFunctionSerializable(isDescribedByKDoc = true)
data class OrderEntity(
  /** The order id. */
  val id: String,
  /** Customer name. */
  val title: String,
  /** The order number. */
  val orderNumber: String,
)

@RequiresApi(36)
@AppFunctionServiceEntryPoint(
  serviceName = "SpikeAppFunctionService",
  appFunctionXmlFileName = "spike_app_function_service",
)
abstract class BaseSpikeAppFunctionService : AppFunctionService() {
  /**
   * Opens a saved order in the app.
   *
   * @param order The order to open.
   * @return A confirmation that the call was handed to the app.
   */
  @AppFunctionDeclaration(isDescribedByKDoc = true)
  suspend fun openSavedOrder(order: OrderEntity): String {
    val invocationId = deliverOpenSavedOrder(applicationContext, order, launch = true)
    return "Delivered($invocationId)"
  }

  /**
   * Finds orders.
   *
   * @param query Optional text to filter orders.
   * @return Matching orders.
   */
  @AppFunctionDeclaration(isDescribedByKDoc = true)
  suspend fun findOrders(query: String?): List<OrderEntity> =
    listOf(
      OrderEntity("4521", "Taylor", "4521"),
      OrderEntity("4523", "Jordan", "4523"),
    ).filter { query.isNullOrBlank() || it.title.contains(query, true) || it.orderNumber.contains(query) }
}

/** Same path an AppFunction call takes into the library queue; optionally brings the app forward. */
fun deliverOpenSavedOrder(context: Context, order: OrderEntity, launch: Boolean): String {
  val t0 = SystemClock.elapsedRealtime()
  val invocationId = UUID.randomUUID().toString()
  val payload = Uri.encode(
    """{"order":{"id":${order.id.toIntOrNull() ?: 0},"number":"${order.orderNumber}","customer":"${order.title}"}}""",
  )
  val uri = Uri.parse("example://app-intents/openSavedOrder?payload=$payload&invocationId=$invocationId")
  val intent = Intent(Intent.ACTION_VIEW, uri).setPackage(context.packageName)
  ReactNativeAppIntentsModule.handleIntent(intent)
  if (launch) {
    try {
      context.startActivity(
        Intent(intent).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
      )
    } catch (e: Exception) {
      Log.w("AppFnSpike", "startActivity blocked: $e")
    }
  }
  Log.i("AppFnSpike", "delivered $invocationId launch=$launch in ${SystemClock.elapsedRealtime() - t0}ms")
  return invocationId
}

class SpikeDebugReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    deliverOpenSavedOrder(
      context,
      OrderEntity(intent.getStringExtra("id") ?: "4521", "Taylor", intent.getStringExtra("n") ?: "4521"),
      launch = intent.getBooleanExtra("launch", false),
    )
  }
}
