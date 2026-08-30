package com.opendle.labelmaker

import android.content.res.Configuration
import android.app.UiModeManager
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.opendle.labelmaker.web.APP_URL
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivityTest {
    @Test
    fun startsTheLocalApplicationAndCompletesAHostInfoRoundTrip() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            waitForApplication(scenario)
            scenario.onActivity { activity ->
                activity.findViewById<WebView>(R.id.labelmaker_web_view).evaluateJavascript(
                    """
                        (() => {
                          const port = window.labelmakerAndroid;
                          if (!port) return false;
                          const id = 'instrumentation-host-info';
                          port.onmessage = (event) => {
                            const reply = JSON.parse(event.data);
                            if (reply.id !== id || reply.ok !== true) return;
                            document.title = `bridge:${'$'}{reply.result.platform}:${'$'}{reply.result.presentation}`;
                          };
                          port.postMessage(JSON.stringify({
                            version: 1,
                            id,
                            method: 'getHostInfo',
                            payload: {},
                          }));
                          return true;
                        })();
                    """.trimIndent(),
                    null,
                )
            }

            waitUntil(scenario) { webView -> webView.title == "bridge:android:mobile-touch" }
        }
    }

    @Test
    fun rejectsARequestWithoutAnExplicitBridgeVersion() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            waitForApplication(scenario)
            scenario.onActivity { activity ->
                activity.findViewById<WebView>(R.id.labelmaker_web_view).evaluateJavascript(
                    """
                        (() => {
                          const port = window.labelmakerAndroid;
                          const id = 'instrumentation-missing-version';
                          port.onmessage = (event) => {
                            const reply = JSON.parse(event.data);
                            if (reply.id === id) {
                              document.title = `missing-version:${'$'}{reply.ok}:${'$'}{reply.error?.code}`;
                            }
                          };
                          port.postMessage(JSON.stringify({
                            id,
                            method: 'getHostInfo',
                            payload: {},
                          }));
                        })();
                    """.trimIndent(),
                    null,
                )
            }

            waitUntil(scenario) { webView -> webView.title == "missing-version:false:INVALID_REQUEST" }
        }
    }

    @Test
    fun repliesWhenWorkspaceValidationFailsBeforeTheSavePickerStarts() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            waitForApplication(scenario)
            scenario.onActivity { activity ->
                activity.findViewById<WebView>(R.id.labelmaker_web_view).evaluateJavascript(
                    """
                        (() => {
                          const port = window.labelmakerAndroid;
                          const id = 'instrumentation-invalid-save';
                          port.onmessage = (event) => {
                            const reply = JSON.parse(event.data);
                            if (reply.id === id) {
                              document.title = `invalid-save:${'$'}{reply.ok}:${'$'}{reply.error?.code}`;
                            }
                          };
                          port.postMessage(JSON.stringify({
                            version: 1,
                            id,
                            method: 'saveWorkspaceFile',
                            payload: {
                              fileName: 'Labels.lbl',
                              gzipBase64: 'bm90LWd6aXA=',
                              saveAs: true,
                            },
                          }));
                        })();
                    """.trimIndent(),
                    null,
                )
            }

            waitUntil(scenario) { webView -> webView.title == "invalid-save:false:INVALID_GZIP" }
        }
    }

    @Test
    fun rejectsExternalNavigation() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            waitForApplication(scenario)
            scenario.onActivity { activity ->
                activity.findViewById<WebView>(R.id.labelmaker_web_view).evaluateJavascript(
                    "document.title = 'before-external';",
                    null,
                )
            }
            waitUntil(scenario) { webView -> webView.title == "before-external" }
            scenario.onActivity { activity ->
                activity.findViewById<WebView>(R.id.labelmaker_web_view).loadUrl("https://example.com/blocked")
            }
            waitUntil(scenario) { webView -> webView.url == APP_URL && webView.title == "Label Maker" }
        }
    }

    @Test
    fun rejectsAnotherMainFrameUrlOnTheLocalOrigin() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            waitForApplication(scenario)
            scenario.onActivity { activity ->
                activity.findViewById<WebView>(R.id.labelmaker_web_view).evaluateJavascript(
                    "document.title = 'before-local-navigation';",
                    null,
                )
            }
            waitUntil(scenario) { webView -> webView.title == "before-local-navigation" }
            scenario.onActivity { activity ->
                activity.findViewById<WebView>(R.id.labelmaker_web_view).loadUrl("$APP_URL?blocked=1")
            }
            waitUntil(scenario) { webView -> webView.url == APP_URL && webView.title == "Label Maker" }
        }
    }

    @Test
    fun republishesDensityAdjustedSafeAreaInsetsAfterReload() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            waitForApplication(scenario)
            scenario.onActivity { activity ->
                activity.findViewById<WebView>(R.id.labelmaker_web_view).reload()
            }
            waitForApplication(scenario)
            scenario.onActivity { activity ->
                activity.findViewById<WebView>(R.id.labelmaker_web_view).evaluateJavascript(
                    """
                        (() => {
                          const style = document.documentElement.style;
                          const top = parseFloat(
                            style.getPropertyValue('--labelmaker-safe-area-top'),
                          );
                          const bottom = parseFloat(
                            style.getPropertyValue('--labelmaker-safe-area-bottom'),
                          );
                          const realistic =
                            top >= 20 && top <= 40 && bottom >= 20 && bottom <= 70;
                          document.title = `insets:${'$'}{realistic}:${'$'}{top}:${'$'}{bottom}`;
                        })();
                    """.trimIndent(),
                    null,
                )
            }
            waitUntil(scenario) { webView -> webView.title?.startsWith("insets:true:") == true }
        }
    }

    @Test
    fun webColorSchemeMatchesTheAndroidTheme() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            waitForApplication(scenario)
            var expectedTitle = ""
            scenario.onActivity { activity ->
                val nightMode = activity.resources.configuration.uiMode and
                    Configuration.UI_MODE_NIGHT_MASK
                val expectedDark = nightMode == Configuration.UI_MODE_NIGHT_YES
                expectedTitle = "color-scheme:$expectedDark"
                activity.findViewById<WebView>(R.id.labelmaker_web_view).evaluateJavascript(
                    """
                        document.title = `color-scheme:${'$'}{
                          window.matchMedia('(prefers-color-scheme: dark)').matches
                        }`;
                    """.trimIndent(),
                    null,
                )
            }
            waitUntil(scenario) { webView -> webView.title == expectedTitle }
        }
    }

    @Test
    fun aLiveNightModeChangeUpdatesTheExistingWebView() {
        val uiModeManager = androidx.test.platform.app.InstrumentationRegistry
            .getInstrumentation()
            .targetContext
            .getSystemService(UiModeManager::class.java)
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            waitForApplication(scenario)
            var webViewIdentity = 0
            var startsDark = false
            scenario.onActivity { activity ->
                val webView = activity.findViewById<WebView>(R.id.labelmaker_web_view)
                webViewIdentity = System.identityHashCode(webView)
                startsDark = activity.resources.configuration.uiMode and
                    Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
            }
            val targetMode = if (startsDark) UiModeManager.MODE_NIGHT_NO else UiModeManager.MODE_NIGHT_YES
            try {
                uiModeManager.setApplicationNightMode(targetMode)
                waitUntil(scenario) { webView ->
                    webView.evaluateJavascript(
                        "document.title = `live-dark:${'$'}{window.matchMedia('(prefers-color-scheme: dark)').matches}`;",
                        null,
                    )
                    System.identityHashCode(webView) == webViewIdentity &&
                        webView.title == "live-dark:${!startsDark}"
                }
            } finally {
                uiModeManager.setApplicationNightMode(
                    if (startsDark) UiModeManager.MODE_NIGHT_YES else UiModeManager.MODE_NIGHT_NO,
                )
            }
        }
    }

    @Test
    fun reloadDropsIncompleteBridgeMessages() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            waitForApplication(scenario)
            scenario.onActivity { activity ->
                activity.findViewById<WebView>(R.id.labelmaker_web_view).evaluateJavascript(
                    """
                        (() => {
                          const request = JSON.stringify({
                            version: 1,
                            id: 'reload-request',
                            method: 'getHostInfo',
                            payload: {},
                          });
                          window.labelmakerAndroid.postMessage(JSON.stringify({
                            type: 'chunk',
                            messageId: 'request-reload-request',
                            index: 0,
                            total: 2,
                            data: request.slice(0, 20),
                          }));
                          window.labelmakerAndroid.onmessage = (event) => {
                            const reply = JSON.parse(event.data);
                            if (reply.id === 'reload-barrier' && reply.ok === true) {
                              document.title = 'chunk-stored';
                            }
                          };
                          window.labelmakerAndroid.postMessage(JSON.stringify({
                            version: 1,
                            id: 'reload-barrier',
                            method: 'getHostInfo',
                            payload: {},
                          }));
                        })();
                    """.trimIndent(),
                    null,
                )
            }
            waitUntil(scenario) { webView -> webView.title == "chunk-stored" }
            scenario.onActivity { activity ->
                activity.findViewById<WebView>(R.id.labelmaker_web_view).reload()
            }
            waitUntil(scenario) { webView ->
                webView.url == APP_URL && webView.progress == 100 && webView.title == "Label Maker"
            }
            scenario.onActivity { activity ->
                activity.findViewById<WebView>(R.id.labelmaker_web_view).evaluateJavascript(
                    """
                        (() => {
                          const request = JSON.stringify({
                            version: 1,
                            id: 'reload-request',
                            method: 'getHostInfo',
                            payload: {},
                          });
                          window.labelmakerAndroid.onmessage = (event) => {
                            const reply = JSON.parse(event.data);
                            if (reply.id !== 'reload-after-barrier' || reply.ok !== true) return;
                            document.title = 'reload-clean';
                            window.labelmakerAndroid.onmessage = () => {
                              document.title = 'reload-leaked';
                            };
                            window.labelmakerAndroid.postMessage(JSON.stringify({
                              type: 'chunk',
                              messageId: 'request-reload-request',
                              index: 1,
                              total: 2,
                              data: request.slice(20),
                            }));
                          };
                          window.labelmakerAndroid.postMessage(JSON.stringify({
                            version: 1,
                            id: 'reload-after-barrier',
                            method: 'getHostInfo',
                            payload: {},
                          }));
                        })();
                    """.trimIndent(),
                    null,
                )
            }
            Thread.sleep(500)
            scenario.onActivity { activity ->
                assertEquals(
                    "reload-clean",
                    activity.findViewById<WebView>(R.id.labelmaker_web_view).title,
                )
            }
        }
    }

    private fun waitUntil(
        scenario: ActivityScenario<MainActivity>,
        condition: (WebView) -> Boolean,
    ) {
        val timeout = System.currentTimeMillis() + 10_000
        while (System.currentTimeMillis() < timeout) {
            var complete = false
            scenario.onActivity { activity ->
                complete = condition(activity.findViewById(R.id.labelmaker_web_view))
            }
            if (complete) return
            Thread.sleep(50)
        }
        assertTrue("The Android application did not reach the expected state.", false)
    }

    private fun waitForApplication(scenario: ActivityScenario<MainActivity>) {
        waitUntil(scenario) { webView ->
            webView.url == APP_URL && webView.progress == 100 && webView.title == "Label Maker"
        }
    }
}
