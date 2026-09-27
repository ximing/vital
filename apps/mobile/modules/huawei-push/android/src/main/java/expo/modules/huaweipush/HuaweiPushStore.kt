package expo.modules.huaweipush

import android.content.Context
import com.huawei.agconnect.AGConnectInstance
import com.huawei.hms.aaid.HmsInstanceId

internal object HuaweiPushStore {
  const val PREFS = "vital.huawei-push"
  private const val KEY_TOKEN = "token"

  fun read(context: Context): String {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_TOKEN, null).orEmpty()
  }

  fun write(context: Context, token: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_TOKEN, token).apply()
  }
}

/** getToken blocks and must run off the main thread. An empty string means HMS is unavailable. */
internal fun fetchHuaweiToken(context: Context): String {
  val cached = HuaweiPushStore.read(context)
  return try {
    AGConnectInstance.initialize(context)
    val appId = AGConnectInstance.getInstance().options.getString("client/app_id")
    if (appId.isNullOrBlank()) return cached
    val token = HmsInstanceId.getInstance(context).getToken(appId, "HCM")
    if (token.isNullOrBlank()) {
      cached
    } else {
      HuaweiPushStore.write(context, token)
      token
    }
  } catch (_: Exception) {
    cached
  }
}
