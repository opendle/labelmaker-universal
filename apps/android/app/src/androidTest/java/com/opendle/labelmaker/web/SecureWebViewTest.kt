package com.opendle.labelmaker.web

import android.net.Uri
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SecureWebViewTest {
    @Test
    fun mainFrameAllowsOnlyTheExactApplicationUrl() {
        assertFalse(shouldBlockNavigation(Uri.parse(APP_URL), isMainFrame = true))
        assertTrue(shouldBlockNavigation(Uri.parse("$APP_URL?reload=1"), isMainFrame = true))
        assertTrue(
            shouldBlockNavigation(
                Uri.parse("$APP_ORIGIN/assets/webapp/other.html"),
                isMainFrame = true,
            ),
        )
    }

    @Test
    fun subframesAllowOnlyLocalAssetResources() {
        assertFalse(
            shouldBlockNavigation(
                Uri.parse("$APP_ORIGIN/assets/webapp/index.js"),
                isMainFrame = false,
            ),
        )
        assertTrue(shouldBlockNavigation(Uri.parse("https://example.com/frame"), isMainFrame = false))
        assertTrue(shouldBlockNavigation(Uri.parse("about:blank"), isMainFrame = false))
    }
}
