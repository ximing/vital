package expo.modules.apkupdater

import android.app.DownloadManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

class ApkUpdaterModule : Module() {
  private var downloadReceiver: BroadcastReceiver? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val prefs
    get() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  override fun definition() = ModuleDefinition {
    Name("ApkUpdater")

    Events("onState")

    OnCreate {
      ensureReceiver()
    }

    OnDestroy {
      val receiver = downloadReceiver ?: return@OnDestroy
      runCatching { context.unregisterReceiver(receiver) }
      downloadReceiver = null
    }

    Function("getState") {
      stateMap()
    }

    Function("canInstall") {
      canRequestInstalls()
    }

    AsyncFunction("startDownload") { url: String, versionCode: Int, sha256: String? ->
      ensureReceiver()
      val ctx = context
      val expected = sha256?.lowercase()?.takeIf { it.length == 64 }
      val dest = destFile(ctx, versionCode)
      if (dest.isFile && dest.length() > 0 && hashMatches(dest, expected)) {
        storeReady(versionCode, dest, expected)
        return@AsyncFunction stateMap()
      }
      val current = stateMap()
      val currentCode = (current["versionCode"] as? Number)?.toInt()
      if (current["status"] == "downloading" && currentCode == versionCode) {
        return@AsyncFunction current
      }
      cancelActiveDownload()
      pruneApks(ctx, keep = versionCode)
      if (dest.exists()) dest.delete()

      val request =
        DownloadManager.Request(Uri.parse(url))
          .setTitle("Vital")
          .setDescription("正在下载更新")
          .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
          .setAllowedOverMetered(true)
          .setAllowedOverRoaming(true)
          .setMimeType("application/vnd.android.package-archive")
          .setDestinationInExternalFilesDir(
            ctx,
            Environment.DIRECTORY_DOWNLOADS,
            dest.name,
          )
      val id = downloadManager().enqueue(request)
      prefs
        .edit()
        .putLong(KEY_DOWNLOAD_ID, id)
        .putInt(KEY_VERSION_CODE, versionCode)
        .putString(KEY_SHA256, expected)
        .putString(KEY_PATH, dest.absolutePath)
        .putString(KEY_STATUS, "downloading")
        .apply()
      emitState()
      stateMap()
    }

    AsyncFunction("cancelDownload") {
      cancelActiveDownload()
      emitState()
    }

    AsyncFunction("openInstallPermissionSettings") {
      val ctx = context
      val intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
          data = Uri.parse("package:${ctx.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      ctx.startActivity(intent)
    }

    AsyncFunction("install") { versionCode: Int ->
      if (!canRequestInstalls()) {
        throw IllegalStateException("INSTALL_PERMISSION")
      }
      val apk = File(prefs.getString(KEY_PATH, null) ?: "")
      val storedCode = prefs.getInt(KEY_VERSION_CODE, -1)
      if (!apk.isFile || storedCode != versionCode) {
        throw IllegalStateException("APK_NOT_READY")
      }
      val expected = prefs.getString(KEY_SHA256, null)
      if (!hashMatches(apk, expected)) {
        apk.delete()
        prefs.edit().putString(KEY_STATUS, "failed").putString(KEY_MESSAGE, "hash mismatch").apply()
        emitState()
        throw IllegalStateException("HASH_MISMATCH")
      }
      commitInstall(apk)
    }
  }

  private fun ensureReceiver() {
    if (downloadReceiver != null) return
    val ctx = appContext.reactContext ?: return
    val receiver =
      object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
          refreshFromDownloadManager()
          emitState()
        }
      }
    val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
    if (Build.VERSION.SDK_INT >= 33) {
      ctx.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
    } else {
      @Suppress("UnspecifiedRegisterReceiverFlag")
      ctx.registerReceiver(receiver, filter)
    }
    downloadReceiver = receiver
  }

  private fun downloadManager(): DownloadManager {
    return context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
  }

  private fun destFile(ctx: Context, versionCode: Int): File {
    val dir = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: ctx.filesDir
    if (!dir.exists()) dir.mkdirs()
    return File(dir, "vital-$versionCode.apk")
  }

  private fun pruneApks(ctx: Context, keep: Int) {
    val dir = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: return
    dir.listFiles()?.forEach { file ->
      if (file.name.startsWith("vital-") && file.name.endsWith(".apk") && file.name != "vital-$keep.apk") {
        file.delete()
      }
    }
  }

  private fun cancelActiveDownload() {
    val id = prefs.getLong(KEY_DOWNLOAD_ID, -1L)
    if (id >= 0) {
      runCatching { downloadManager().remove(id) }
    }
    prefs
      .edit()
      .remove(KEY_DOWNLOAD_ID)
      .remove(KEY_STATUS)
      .remove(KEY_MESSAGE)
      .apply()
  }

  private fun canRequestInstalls(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
    return context.packageManager.canRequestPackageInstalls()
  }

  private fun storeReady(versionCode: Int, dest: File, sha256: String?) {
    prefs
      .edit()
      .remove(KEY_DOWNLOAD_ID)
      .putInt(KEY_VERSION_CODE, versionCode)
      .putString(KEY_PATH, dest.absolutePath)
      .putString(KEY_SHA256, sha256)
      .putString(KEY_STATUS, "ready")
      .remove(KEY_MESSAGE)
      .apply()
  }

  private fun refreshFromDownloadManager() {
    val id = prefs.getLong(KEY_DOWNLOAD_ID, -1L)
    if (id < 0) return
    val cursor = downloadManager().query(DownloadManager.Query().setFilterById(id)) ?: return
    cursor.use {
      if (!it.moveToFirst()) return
      val status = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
      if (status == DownloadManager.STATUS_SUCCESSFUL) {
        val versionCode = prefs.getInt(KEY_VERSION_CODE, -1)
        val dest = File(prefs.getString(KEY_PATH, "") ?: "")
        val expected = prefs.getString(KEY_SHA256, null)
        if (!dest.isFile) {
          prefs.edit().putString(KEY_STATUS, "failed").putString(KEY_MESSAGE, "missing file").apply()
          return
        }
        if (!hashMatches(dest, expected)) {
          dest.delete()
          prefs.edit().putString(KEY_STATUS, "failed").putString(KEY_MESSAGE, "hash mismatch").apply()
          return
        }
        storeReady(versionCode, dest, expected)
      } else if (status == DownloadManager.STATUS_FAILED) {
        prefs.edit().putString(KEY_STATUS, "failed").putString(KEY_MESSAGE, "download failed").apply()
      }
    }
  }

  private fun stateMap(): Map<String, Any?> {
    refreshFromDownloadManager()
    val stored = prefs.getString(KEY_STATUS, null)
    val versionCode = prefs.getInt(KEY_VERSION_CODE, -1).takeIf { it > 0 }
    val path = prefs.getString(KEY_PATH, null)
    val message = prefs.getString(KEY_MESSAGE, null)
    val id = prefs.getLong(KEY_DOWNLOAD_ID, -1L)
    var bytes = 0L
    var total = 0L
    var status = stored ?: "idle"
    if (id >= 0 && status == "downloading") {
      val cursor = downloadManager().query(DownloadManager.Query().setFilterById(id))
      cursor?.use {
        if (it.moveToFirst()) {
          bytes = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
          total = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)).coerceAtLeast(0)
          val dmStatus = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
          if (dmStatus == DownloadManager.STATUS_SUCCESSFUL) {
            status = "ready"
          } else if (dmStatus == DownloadManager.STATUS_FAILED) {
            status = "failed"
          }
        }
      }
    }
    if (status == "ready" && path != null && File(path).isFile) {
      total = File(path).length()
      bytes = total
    }
    return mapOf(
      "status" to status,
      "versionCode" to versionCode,
      "bytesDownloaded" to bytes.toDouble(),
      "totalBytes" to total.toDouble(),
      "path" to path,
      "message" to message,
    )
  }

  private fun emitState() {
    sendEvent("onState", stateMap())
  }

  private fun commitInstall(apk: File) {
    val ctx = context
    val installer = ctx.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
    params.setSize(apk.length())
    if (Build.VERSION.SDK_INT >= 34) {
      params.setPackageSource(PackageInstaller.PACKAGE_SOURCE_LOCAL_FILE)
    }
    if (Build.VERSION.SDK_INT >= 31) {
      params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
    }
    val sessionId = installer.createSession(params)
    val session = installer.openSession(sessionId)
    try {
      FileInputStream(apk).use { input ->
        session.openWrite("base.apk", 0, apk.length()).use { out ->
          input.copyTo(out)
          session.fsync(out)
        }
      }
      val intent = Intent(ctx, ApkInstallReceiver::class.java)
      val flags =
        PendingIntent.FLAG_UPDATE_CURRENT or
          (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
      val pending = PendingIntent.getBroadcast(ctx, sessionId, intent, flags)
      session.commit(pending.intentSender)
    } catch (err: Exception) {
      runCatching { session.abandon() }
      throw err
    } finally {
      session.close()
    }
  }

  companion object {
    private const val PREFS = "vital.apk-updater"
    private const val KEY_DOWNLOAD_ID = "downloadId"
    private const val KEY_VERSION_CODE = "versionCode"
    private const val KEY_SHA256 = "sha256"
    private const val KEY_PATH = "path"
    private const val KEY_STATUS = "status"
    private const val KEY_MESSAGE = "message"

    fun hashMatches(file: File, expected: String?): Boolean {
      if (expected.isNullOrEmpty()) return true
      return sha256(file) == expected.lowercase()
    }

    fun sha256(file: File): String {
      val digest = MessageDigest.getInstance("SHA-256")
      FileInputStream(file).use { input ->
        val buf = ByteArray(64 * 1024)
        while (true) {
          val n = input.read(buf)
          if (n <= 0) break
          digest.update(buf, 0, n)
        }
      }
      return digest.digest().joinToString("") { byte -> "%02x".format(byte) }
    }
  }
}
