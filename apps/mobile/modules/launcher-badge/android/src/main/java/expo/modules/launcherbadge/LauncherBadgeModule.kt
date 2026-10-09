package expo.modules.launcherbadge

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import me.leolin.shortcutbadger.ShortcutBadger

class LauncherBadgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LauncherBadge")

    AsyncFunction("clear") { promise: Promise ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      promise.resolve(ShortcutBadger.removeCount(context))
    }
  }
}
