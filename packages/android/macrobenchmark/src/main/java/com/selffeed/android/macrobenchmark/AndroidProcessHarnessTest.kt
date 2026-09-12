package com.selffeed.android.macrobenchmark

import android.content.ComponentName
import android.content.Intent
import android.os.Process
import android.os.SystemClock
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.io.ByteArrayOutputStream

/** The runner is self-instrumented and therefore survives the target app's death. */
@RunWith(AndroidJUnit4::class)
class AndroidProcessHarnessTest {
    @Test
    fun externalRunnerSurvivesBackgroundProcessDeathAndRoomIsRecovered() {
        val target = BuildConfig.TARGET_PACKAGE
        check(target == "com.selffeed.android.performancetest") { "Recovery requires the isolated performance target" }
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assertEquals("com.selffeed.android.macrobenchmark", instrumentation.targetContext.packageName)
        val device = UiDevice.getInstance(instrumentation)
        device.wakeUp()
        val nonce = UUID.randomUUID().toString()
        val launch = Intent(Intent.ACTION_MAIN).apply {
            component = ComponentName(target, "com.selffeed.android.RecoveryFixtureActivity")
            addCategory(Intent.CATEGORY_LAUNCHER)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
            putExtra("fixtureNonce", nonce)
        }
        instrumentation.context.startActivity(Intent(launch).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        })
        val ready = device.wait(Until.hasObject(By.text(nonce)), 15_000)
        val hierarchy = if (ready) "" else ByteArrayOutputStream().also(device::dumpWindowHierarchy).toString()
        assertTrue("Initial Room fixture was not displayed: $hierarchy", ready)
        val sessionOwner = device.findObject(By.textStartsWith("Owner: ")).text
        UUID.fromString(sessionOwner.removePrefix("Owner: "))
        device.findObject(By.text("Confirm fixture")).click()
        assertTrue(device.wait(Until.hasObject(By.text("Fixture confirmed")), 5_000))
        val oldPid = device.executeShellCommand("pidof $target").trim()
        assertTrue(oldPid.isNotEmpty())
        assertNotEquals(Process.myPid().toString(), oldPid)
        device.pressHome()
        assertTrue(device.wait(Until.gone(By.pkg(target).depth(0)), 5_000))
        // Give onStop/save-state a chance to finish before asking Android to
        // kill a background process. force-stop would test a different policy.
        SystemClock.sleep(1_000)
        device.executeShellCommand("am kill --user current $target")
        val deadline = SystemClock.uptimeMillis() + 10_000
        while (device.executeShellCommand("pidof $target").isNotBlank() && SystemClock.uptimeMillis() < deadline) {
            SystemClock.sleep(100)
        }
        assertEquals("", device.executeShellCommand("pidof $target").trim())
        instrumentation.context.startActivity(launch)
        assertTrue(device.wait(Until.hasObject(By.text("Restored process")), 15_000))
        assertTrue(device.wait(Until.hasObject(By.text("Fixture confirmed")), 5_000))
        assertTrue(device.hasObject(By.text(nonce)))
        assertTrue("Session owner changed across process death", device.hasObject(By.text(sessionOwner)))
        val newPid = device.executeShellCommand("pidof $target").trim()
        assertTrue(newPid.isNotEmpty())
        assertNotEquals(oldPid, newPid)
        Log.i("AndroidReview", "Room, session owner and task restored: target $oldPid -> $newPid; runner ${Process.myPid()}")
    }
}
