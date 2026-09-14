package com.slopcoder_mobile.appinfo

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.module.annotations.ReactModule
import com.slopcoder_mobile.BuildConfig

/**
 * The version the binary actually carries — see AppInfo.swift for why the
 * package version was never the right thing to show.
 */
@ReactModule(name = AppInfoModule.NAME)
class AppInfoModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName(): String = NAME

  override fun getConstants(): Map<String, Any> =
      mapOf("version" to BuildConfig.VERSION_NAME, "build" to BuildConfig.VERSION_CODE.toString())

  companion object {
    const val NAME = "AppInfo"
  }
}
