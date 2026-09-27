package expo.modules.huaweipush

import android.os.Bundle
import com.huawei.hms.push.HmsMessageService

/** Persists a rotated token when the JS runtime is not running. */
class HuaweiPushService : HmsMessageService() {
  override fun onNewToken(token: String?) {
    store(token)
  }

  override fun onNewToken(token: String?, bundle: Bundle?) {
    store(token)
  }

  private fun store(token: String?) {
    if (token.isNullOrBlank()) return
    HuaweiPushStore.write(this, token)
  }
}
