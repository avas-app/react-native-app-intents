package com.avasapp.appintents.example.appfunctions

import android.content.Context
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.appfunctions.AppFunctionDeclaration
import androidx.appfunctions.AppFunctionManager
import androidx.appfunctions.AppFunctionSerializable
import androidx.appfunctions.AppFunctionService
import androidx.appfunctions.AppFunctionServiceEntryPoint
import com.reactnativeappintents.ReactNativeAppIntentsAppFunctions
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

@AppFunctionSerializable(isDescribedByKDoc = true)
data class AppIntentResult(
  /** The delivery status of the AppFunction call. */
  val status: String,
  /** The id of the delivered invocation, shared with the App Actions delivery path. */
  val invocationId: String,
)

/**
 * Order
 */
@AppFunctionSerializable(isDescribedByKDoc = true)
data class OrderEntity(
  val id: Int,
  val number: String,
  val customer: String,
)

private fun OrderEntity.reactNativeAppIntentsJson(): JSONObject {
  val json = JSONObject()
  json.put("id", id)
  json.put("number", number)
  json.put("customer", customer)
  return json
}

/**
 * Address
 */
@AppFunctionSerializable(isDescribedByKDoc = true)
data class ShipOrderAddress(
  /** Street */
  val street: String,
  /** City */
  val city: ShipOrderAddressCity,
)

private fun ShipOrderAddress.reactNativeAppIntentsJson(): JSONObject {
  val json = JSONObject()
  json.put("street", street)
  json.put("city", city.reactNativeAppIntentsJson())
  return json
}

/**
 * City
 */
@AppFunctionSerializable(isDescribedByKDoc = true)
data class ShipOrderAddressCity(
  /** City */
  val name: String,
)

private fun ShipOrderAddressCity.reactNativeAppIntentsJson(): JSONObject {
  val json = JSONObject()
  json.put("name", name)
  return json
}

private fun reactNativeAppIntentsParseOrderEntity(json: JSONObject): OrderEntity {
  return OrderEntity(
    id = json.getInt("id"),
    number = json.getString("number"),
    customer = json.getString("customer"),
  )
}

private class ReactNativeAppIntentsCatalogEntry(
  val id: String,
  val title: String,
  val synonyms: List<String>,
  val value: JSONObject,
)

private fun reactNativeAppIntentsParseCatalog(json: String?): List<ReactNativeAppIntentsCatalogEntry>? {
  if (json == null) {
    return null
  }

  return try {
    val array = JSONArray(json)
    (0 until array.length()).map { index ->
      val item = array.getJSONObject(index)
      ReactNativeAppIntentsCatalogEntry(
        id = item.getString("id"),
        title = item.getString("title"),
        synonyms = item.optJSONArray("synonyms")?.let { synonyms ->
          (0 until synonyms.length()).map { synonyms.getString(it) }
        } ?: emptyList(),
        value = item.getJSONObject("value"),
      )
    }
  } catch (error: Exception) {
    null
  }
}

private fun reactNativeAppIntentsCatalogEntries(
  context: Context,
  entityId: String,
): List<ReactNativeAppIntentsCatalogEntry> {
  val stored = reactNativeAppIntentsParseCatalog(
    context.getSharedPreferences("ReactNativeAppIntents", Context.MODE_PRIVATE)
      .getString("ReactNativeAppIntentsEntityCatalog." + entityId, null),
  )

  if (stored != null) {
    return stored
  }

  return when (entityId) {
    "Order" -> reactNativeAppIntentsSeedOrders
    else -> emptyList()
  }
}

private val reactNativeAppIntentsSeedOrders: List<ReactNativeAppIntentsCatalogEntry> = listOf(
  ReactNativeAppIntentsCatalogEntry(
    id = "1",
    title = "Order #1234",
    synonyms = emptyList(),
    value = JSONObject("{\"id\":1,\"number\":\"1234\",\"customer\":\"Taylor\"}"),
  ),
)

@RequiresApi(36)
@AppFunctionServiceEntryPoint(
  serviceName = "AppIntentsAppFunctionService",
  appFunctionXmlFileName = "app_intents_app_function_service",
)
abstract class BaseAppIntentsAppFunctionService : AppFunctionService() {
  /**
   * Ship Order
   *
   * Ship a saved order.
   *
   * @param order Order. Which order?
   * @param note Note. Add a note.
   * @param count Count
   * @param weight Weight
   * @param rush Rush
   * @param shipDate Ship Date
   * @param address Address
   * @param coupon Coupon
   * @return A confirmation that the call was handed to the app.
   */
  @AppFunctionDeclaration(isDescribedByKDoc = true, isEnabled = false)
  suspend fun shipOrder(order: OrderEntity, note: String?, count: Int, weight: Double, rush: Boolean, shipDate: String?, address: ShipOrderAddress, coupon: String?): AppIntentResult {
    val payload = JSONObject()
    payload.put("order", order.reactNativeAppIntentsJson())
    note?.let { payload.put("note", it) }
    payload.put("count", count)
    payload.put("weight", weight)
    payload.put("rush", rush)
    shipDate?.let { payload.put("shipDate", it) }
    payload.put("address", address.reactNativeAppIntentsJson())
    payload.put("coupon", coupon ?: "SAVE10")
    val payloadJson = payload.toString()
    val invocationId = ReactNativeAppIntentsAppFunctions.deliver(
      applicationContext,
      "example",
      "shipOrder",
      payloadJson,
      true,
    )
    return AppIntentResult(status = "delivered", invocationId = invocationId)
  }

  /**
   * Finds Order records.
   *
   * @param query Optional text to filter Order.
   * @return Matching Order records.
   */
  @AppFunctionDeclaration(isDescribedByKDoc = true)
  suspend fun findOrders(query: String?): List<OrderEntity> {
    val normalizedQuery = query?.trim()?.takeIf { it.isNotEmpty() }?.lowercase()
    return reactNativeAppIntentsCatalogEntries(
      applicationContext,
      "Order",
    )
      .filter { entry ->
        normalizedQuery == null ||
          entry.title.lowercase().contains(normalizedQuery) ||
          entry.synonyms.any { synonym -> synonym.lowercase().contains(normalizedQuery) }
      }
      .mapNotNull { entry ->
        reactNativeAppIntentsParseOrderEntity(entry.value)
      }
  }
}

private val reactNativeAppIntentsAppFunctionScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

object ReactNativeAppIntentsAppFunctionsBridge {
  @JvmStatic
  fun setEnabled(context: Context, intentId: String, enabled: Boolean) {
    val functionId = when (intentId) {
      "shipOrder" -> BaseAppIntentsAppFunctionServiceIds.SHIP_ORDER_ID
      else -> return
    }
    val applicationContext = context.applicationContext
    reactNativeAppIntentsAppFunctionScope.launch {
      try {
        AppFunctionManager.getInstance(applicationContext)?.setAppFunctionEnabled(
          functionId,
          if (enabled) {
            AppFunctionManager.APP_FUNCTION_STATE_ENABLED
          } else {
            AppFunctionManager.APP_FUNCTION_STATE_DISABLED
          },
        )
      } catch (error: Exception) {
        Log.w("ReactNativeAppIntents", "Could not update the AppFunction state.", error)
      }
    }
  }
}
