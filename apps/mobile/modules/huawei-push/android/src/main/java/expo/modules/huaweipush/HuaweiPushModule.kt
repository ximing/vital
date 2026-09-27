package expo.modules.huaweipush

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HuaweiPushModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HuaweiPush")

    AsyncFunction("getToken") { promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx == null) {
        promise.resolve("")
        return@AsyncFunction
      }
      Thread {
        promise.resolve(fetchHuaweiToken(ctx))
      }.start()
    }
  }
}
