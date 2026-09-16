package com.slopcoder_mobile.shake

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class ShakePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
      listOf(ShakeModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
      emptyList()
}
