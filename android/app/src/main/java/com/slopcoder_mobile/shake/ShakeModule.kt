package com.slopcoder_mobile.shake

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.module.annotations.ReactModule
import kotlin.math.sqrt

/**
 * Shake detection, which Android does not hand you the way iOS does.
 *
 * `ShakeWindow.swift` gets the gesture from UIKit for free; here the only
 * source is the accelerometer, so this is the detector Apple already wrote,
 * written again: total acceleration well past gravity, a handful of times,
 * inside a short window. The thresholds are the ones the platform's own
 * ShakeDetector uses, and are deliberately not adjustable — a shake that
 * sometimes needs two goes reads as a broken feature.
 *
 * The sensor is registered only between [start] and [stop]. A screen that is
 * not listening for a shake must not hold an accelerometer open: the phone
 * wakes the sensor hub for it, and the cost lands on a battery figure nobody
 * will trace back to here.
 */
@ReactModule(name = ShakeModule.NAME)
class ShakeModule(context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), SensorEventListener {

  private val sensors =
      context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager

  private var accelerometer: Sensor? = null
  private var hits = 0
  private var firstHitAt = 0L
  private var lastHitAt = 0L

  override fun getName(): String = NAME

  @ReactMethod
  fun start() {
    val manager = sensors ?: return
    if (accelerometer != null) return

    accelerometer = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
    hits = 0
    firstHitAt = 0L
    lastHitAt = 0L
    manager.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_UI)
  }

  @ReactMethod
  fun stop() {
    val manager = sensors ?: return
    if (accelerometer == null) return
    manager.unregisterListener(this)
    accelerometer = null
  }

  /** NativeEventEmitter calls these; without them RN warns on every listener. */
  @ReactMethod fun addListener(eventName: String) = Unit

  @ReactMethod fun removeListeners(count: Double) = Unit

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  override fun onSensorChanged(event: SensorEvent?) {
    val values = event?.values ?: return
    if (values.size < 3) return

    val g =
        sqrt(
            (values[0] * values[0] + values[1] * values[1] + values[2] * values[2]).toDouble()
        ) / SensorManager.GRAVITY_EARTH
    if (g < FORCE_THRESHOLD) return

    val now = System.currentTimeMillis()
    // Consecutive samples of one jolt are one hit, not several.
    if (now - lastHitAt < MIN_GAP_MS) return
    // A jolt too long after the last one starts the count over, so a day of
    // being carried around never adds up to a shake.
    if (now - firstHitAt > WINDOW_MS) {
      hits = 0
      firstHitAt = now
    }

    lastHitAt = now
    if (++hits < REQUIRED_HITS) return

    hits = 0
    firstHitAt = 0L
    reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("shake", null)
  }

  override fun invalidate() {
    stop()
    super.invalidate()
  }

  companion object {
    const val NAME = "ShakeDetector"

    /** Multiples of gravity. Below this it is a phone being set down. */
    private const val FORCE_THRESHOLD = 2.2

    private const val REQUIRED_HITS = 3
    private const val MIN_GAP_MS = 100L
    private const val WINDOW_MS = 800L
  }
}
