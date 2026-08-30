package com.opendle.labelmaker

import android.Manifest
import android.content.pm.PackageManager
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class HardwareSmokeTest {
    @Test
    fun discoversAddsAndPrintsOnConfirmedHardwareDevice() {
        val arguments = InstrumentationRegistry.getArguments()
        assumeTrue(
            "Set labelmakerHardwareConfirmed=true only when a person is ready to supervise the hardware test.",
            arguments.getString("labelmakerHardwareConfirmed") == "true",
        )

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertEquals(
            PackageManager.PERMISSION_GRANTED,
            context.checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN),
        )
        assertEquals(
            PackageManager.PERMISSION_GRANTED,
            context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT),
        )
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                assertEquals("com.opendle.labelmaker.debug", activity.packageName)
            }
            waitFor(scenario, 15_000) {
                "document.querySelector('.label-canvas') !== null"
            }
            evaluate(
                scenario,
                "localStorage.removeItem('labelmaker.android.printers.v1'); location.reload(); true",
            )
            waitFor(scenario, 15_000) {
                "document.querySelector('.label-canvas') !== null && document.querySelector('[aria-label=\"Add printer\"]') !== null"
            }
            assertEquals(
                "true",
                evaluate(
                    scenario,
                    "(() => { const button = document.querySelector('[aria-label=\"Add printer\"]'); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true; })()",
                ),
            )
            waitFor(scenario, 20_000) {
                "[...document.querySelectorAll('.discovery-item')].some((item) => /MakeID E1/i.test(item.textContent ?? '') && !item.querySelector('button')?.disabled)"
            }
            assertEquals(
                "true",
                evaluate(
                    scenario,
                    "(() => { const item = [...document.querySelectorAll('.discovery-item')].find((candidate) => /MakeID E1/i.test(candidate.textContent ?? '')); const button = item?.querySelector('button'); if (!(button instanceof HTMLButtonElement) || button.disabled) return false; button.click(); return true; })()",
                ),
            )
            waitFor(scenario, 45_000) {
                "document.querySelector('.add-printer-modal') === null && document.querySelector('[aria-label^=\"Selected printer:\"]') !== null"
            }
            assertEquals(
                "true",
                evaluate(
                    scenario,
                    "(() => { const button = document.querySelector('[aria-label=\"Print\"]'); if (!(button instanceof HTMLButtonElement) || button.disabled) return false; button.click(); return true; })()",
                ),
            )
            waitFor(scenario, 120_000) {
                "[...document.querySelectorAll('.toast')].some((toast) => /label sent to/i.test(toast.textContent ?? ''))"
            }
        }
    }

    private fun waitFor(
        scenario: ActivityScenario<MainActivity>,
        timeoutMs: Long,
        expression: () -> String,
    ) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (evaluate(scenario, expression()) == "true") return
            Thread.sleep(100)
        }
        assertTrue("The confirmed MakeID E1 hardware step did not finish.", false)
    }

    private fun evaluate(scenario: ActivityScenario<MainActivity>, script: String): String {
        val latch = CountDownLatch(1)
        var result = "null"
        scenario.onActivity { activity ->
            activity.findViewById<WebView>(R.id.labelmaker_web_view).evaluateJavascript(script) { value ->
                result = value
                latch.countDown()
            }
        }
        assertTrue("The Android WebView did not return a hardware-test result.", latch.await(5, TimeUnit.SECONDS))
        return result
    }
}
