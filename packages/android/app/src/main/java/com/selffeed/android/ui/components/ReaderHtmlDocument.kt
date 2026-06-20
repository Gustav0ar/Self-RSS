package com.selffeed.android.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import com.selffeed.android.ui.utils.isTrustedEmbedUrl
import java.net.URI
import java.util.Locale

internal data class ReaderHtmlColors(
    val background: String,
    val text: String,
    val surface: String,
    val mutedText: String,
    val link: String,
    val textOnLightBackground: String = "#111827",
    val textOnDarkBackground: String = "#F8FAFC",
    val linkOnLightBackground: String = "#3345B8",
    val linkOnDarkBackground: String = "#A7B5FF",
)

internal fun readerHtmlColors(
    backgroundColor: Color,
    textColor: Color,
    surfaceColor: Color,
    mutedTextColor: Color,
    linkColor: Color,
): ReaderHtmlColors =
    ReaderHtmlColors(
        background = backgroundColor.toCssHex(),
        text = textColor.toCssHex(),
        surface = surfaceColor.toCssHex(),
        mutedText = mutedTextColor.toCssHex(),
        link = linkColor.toCssHex(),
    )

internal fun buildReaderHtmlDocument(
    html: String,
    colors: ReaderHtmlColors,
): String {
    val safeHtml = sanitizeReaderHtml(html)
    return """
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
            <style>
                :root {
                    color-scheme: light dark;
                    --reader-background: ${colors.background};
                    --reader-text: ${colors.text};
                    --reader-surface: ${colors.surface};
                    --reader-muted-text: ${colors.mutedText};
                    --reader-link: ${colors.link};
                }
                html, body {
                    background: var(--reader-background) !important;
                    color: var(--reader-text) !important;
                    margin: 0;
                    padding: 0;
                    overflow-x: auto;
                    overflow-y: hidden;
                    word-wrap: break-word;
                }
                body {
                    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Roboto", sans-serif;
                    font-size: 16px;
                    line-height: 1.62;
                }
                #content-container {
                    background: transparent;
                    color: var(--reader-text);
                    display: flow-root;
                    min-height: 100px;
                }
                #content-container * {
                    box-sizing: border-box;
                    max-width: 100%;
                    min-width: 0;
                }
                a {
                    color: var(--reader-link);
                    overflow-wrap: anywhere;
                }
                p, li, blockquote, figcaption, table, pre {
                    color: inherit;
                }
                blockquote, aside, section, article, details, table, pre {
                    border-color: color-mix(in srgb, var(--reader-muted-text) 36%, transparent);
                }
                table {
                    border-collapse: collapse;
                    margin: 12px 0;
                    width: 100%;
                    table-layout: fixed;
                    max-width: 100%;
                }
                th, td {
                    padding: 8px 12px;
                    white-space: normal;
                    word-break: normal;
                    overflow-wrap: break-word;
                    border: 1px solid color-mix(in srgb, var(--reader-muted-text) 28%, transparent);
                }
                th {
                    background: color-mix(in srgb, var(--reader-surface) 60%, transparent);
                    font-weight: 600;
                    text-align: left;
                }
                pre, code {
                    background: color-mix(in srgb, var(--reader-surface) 82%, transparent);
                    color: inherit;
                    white-space: pre-wrap;
                    overflow-wrap: anywhere;
                }
                mark {
                    background: #FDE68A;
                    color: #111827;
                    border-radius: 4px;
                    padding: 0 0.2em;
                }
                img, video {
                    max-width: 100% !important;
                    width: auto !important;
                    height: auto !important;
                    border-radius: 12px;
                    display: block;
                    margin: 12px 0;
                }
                iframe {
                    max-width: 100% !important;
                    width: 100% !important;
                    height: 500px;
                    border-radius: 12px;
                    display: block;
                    margin: 12px 0;
                    border: none;
                }
                .embedded-media--x {
                    height: 600px;
                }
                .embedded-media--youtube,
                .embedded-media--vimeo,
                .embedded-media--streamable,
                .embedded-media--videopress {
                    aspect-ratio: 16 / 9;
                    height: auto;
                }
                .table-scroll {
                    overflow-x: auto;
                    -webkit-overflow-scrolling: touch;
                }
            </style>
        </head>
        <body>
            <div id="content-container">$safeHtml</div>
            <script>
                const readerColors = {
                    background: '${colors.background}',
                    text: '${colors.text}',
                    textOnLightBackground: '${colors.textOnLightBackground}',
                    textOnDarkBackground: '${colors.textOnDarkBackground}',
                    linkOnLightBackground: '${colors.linkOnLightBackground}',
                    linkOnDarkBackground: '${colors.linkOnDarkBackground}'
                };
                const minimumReadableContrast = 4.5;

                function parseCssColor(value) {
                    if (!value || value === 'transparent') {
                        return null;
                    }

                    const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})${'$'}/i);
                    if (hex) {
                        const raw = hex[1].length === 3
                            ? hex[1].split('').map(part => part + part).join('')
                            : hex[1];
                        return {
                            r: Number.parseInt(raw.slice(0, 2), 16),
                            g: Number.parseInt(raw.slice(2, 4), 16),
                            b: Number.parseInt(raw.slice(4, 6), 16),
                            a: 1
                        };
                    }

                    const parts = value.match(/[\d.]+/g);
                    if (!parts || parts.length < 3) {
                        return null;
                    }

                    return {
                        r: Number.parseFloat(parts[0]),
                        g: Number.parseFloat(parts[1]),
                        b: Number.parseFloat(parts[2]),
                        a: parts.length >= 4 ? Math.min(1, Number.parseFloat(parts[3])) : 1
                    };
                }

                function blend(foreground, background) {
                    const alpha = foreground.a == null ? 1 : foreground.a;
                    return {
                        r: foreground.r * alpha + background.r * (1 - alpha),
                        g: foreground.g * alpha + background.g * (1 - alpha),
                        b: foreground.b * alpha + background.b * (1 - alpha),
                        a: 1
                    };
                }

                function channelLuminance(value) {
                    const normalized = value / 255;
                    return normalized <= 0.03928
                        ? normalized / 12.92
                        : Math.pow((normalized + 0.055) / 1.055, 2.4);
                }

                function luminance(color) {
                    return 0.2126 * channelLuminance(color.r) +
                        0.7152 * channelLuminance(color.g) +
                        0.0722 * channelLuminance(color.b);
                }

                function contrastRatio(foreground, background) {
                    const opaqueForeground = blend(foreground, background);
                    const lighter = Math.max(luminance(opaqueForeground), luminance(background));
                    const darker = Math.min(luminance(opaqueForeground), luminance(background));
                    return (lighter + 0.05) / (darker + 0.05);
                }

                function effectiveBackground(element) {
                    const pageBackground = parseCssColor(readerColors.background) || { r: 255, g: 255, b: 255, a: 1 };
                    const chain = [];
                    let current = element;

                    while (current && current.nodeType === Node.ELEMENT_NODE) {
                        chain.unshift(current);
                        current = current.parentElement;
                    }

                    return chain.reduce((background, node) => {
                        const color = parseCssColor(window.getComputedStyle(node).backgroundColor);
                        return color && color.a > 0 ? blend(color, background) : background;
                    }, pageBackground);
                }

                function hasReadableText(element) {
                    const tagName = element.tagName;
                    if (['SCRIPT', 'STYLE', 'TEMPLATE', 'IMG', 'PICTURE', 'SOURCE', 'VIDEO', 'AUDIO', 'IFRAME', 'BR', 'HR'].includes(tagName)) {
                        return false;
                    }

                    return Array.from(element.childNodes).some(node =>
                        node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0
                    );
                }

                function readableColorFor(background, element) {
                    const isLightBackground = luminance(background) > 0.48;
                    const isLink = element.closest('a') !== null;

                    if (isLink) {
                        return isLightBackground
                            ? readerColors.linkOnLightBackground
                            : readerColors.linkOnDarkBackground;
                    }

                    return isLightBackground
                        ? readerColors.textOnLightBackground
                        : readerColors.textOnDarkBackground;
                }

                function normalizeReadableColors() {
                    const container = document.getElementById('content-container');
                    if (!container) {
                        return;
                    }

                    const candidates = [container, ...container.querySelectorAll('*')];
                    candidates.forEach(element => {
                        if (!hasReadableText(element)) {
                            return;
                        }

                        const style = window.getComputedStyle(element);
                        if (style.display === 'none' || style.visibility === 'hidden') {
                            return;
                        }

                        const background = effectiveBackground(element);
                        const foreground = parseCssColor(style.color) || parseCssColor(readerColors.text);
                        if (!foreground) {
                            return;
                        }

                        if (contrastRatio(foreground, background) < minimumReadableContrast) {
                            const readableColor = readableColorFor(background, element);
                            element.style.setProperty('color', readableColor, 'important');
                            element.style.setProperty('-webkit-text-fill-color', readableColor, 'important');
                        }
                    });
                }

                function prepareEmbeds() {
                    document.querySelectorAll('iframe').forEach(iframe => {
                        iframe.setAttribute('allowfullscreen', '');
                        iframe.setAttribute(
                            'allow',
                            'accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share'
                        );
                        iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
                    });
                }

                function wrapTables() {
                    document.querySelectorAll('table').forEach(table => {
                        if (table.parentElement && table.parentElement.classList.contains('table-scroll')) {
                            return;
                        }
                        const wrapper = document.createElement('div');
                        wrapper.className = 'table-scroll';
                        table.parentNode.insertBefore(wrapper, table);
                        wrapper.appendChild(table);
                    });
                }

                function measureContentHeight() {
                    prepareEmbeds();
                    wrapTables();
                    normalizeReadableColors();

                    const container = document.getElementById('content-container');
                    if (!container) {
                        return 0;
                    }

                    const containerRect = container.getBoundingClientRect();
                    let bottom = containerRect.bottom;

                    container.querySelectorAll('*').forEach(element => {
                        const style = window.getComputedStyle(element);
                        if (style.display === 'none') {
                            return;
                        }

                        const rect = element.getBoundingClientRect();
                        const marginBottom = Number.parseFloat(style.marginBottom) || 0;
                        bottom = Math.max(bottom, rect.bottom + marginBottom);
                    });

                    return Math.ceil(Math.max(container.scrollHeight, bottom - containerRect.top));
                }

                function postHeight() {
                    const height = measureContentHeight();

                    if (height > 50 && window.Android && typeof window.Android.updateHeight === 'function') {
                        window.Android.updateHeight(height);
                    }
                }

                function scheduleReaderUpdate() {
                    window.requestAnimationFrame(postHeight);
                }

                // Named handlers so they can be removed during cleanup
                function handleLoad() { postHeight(); }
                function handleResize() { postHeight(); }
                function handleDomContentLoaded() { postHeight(); }

                window.addEventListener('load', handleLoad);
                window.addEventListener('resize', handleResize);
                document.addEventListener('DOMContentLoaded', handleDomContentLoaded);

                const resizeObserver = new ResizeObserver(scheduleReaderUpdate);
                resizeObserver.observe(document.body);
                const contentContainer = document.getElementById('content-container');
                if (contentContainer) {
                    resizeObserver.observe(contentContainer);
                }

                const mutationObserver = new MutationObserver(scheduleReaderUpdate);
                if (contentContainer) {
                    mutationObserver.observe(contentContainer, {
                        attributes: true,
                        attributeFilter: ['class', 'style', 'bgcolor', 'color'],
                        childList: true,
                        subtree: true
                    });
                }

                let lastH = 0;
                let fallbackChecks = 0;
                const fallbackTimer = setInterval(() => {
                    fallbackChecks += 1;
                    const h = measureContentHeight();
                    if (h !== lastH) {
                        lastH = h;
                        postHeight();
                    }
                    if (fallbackChecks >= 10) {
                        clearInterval(fallbackTimer);
                    }
                }, 250);

                // Expose cleanup function to prevent memory leaks
                window.SelfFeedApp = {
                    cleanup: function() {
                        window.removeEventListener('load', handleLoad);
                        window.removeEventListener('resize', handleResize);
                        document.removeEventListener('DOMContentLoaded', handleDomContentLoaded);
                        if (resizeObserver) resizeObserver.disconnect();
                        if (mutationObserver) mutationObserver.disconnect();
                        if (fallbackTimer) clearInterval(fallbackTimer);
                    }
                };

                function parseMessageData(data) {
                    if (typeof data !== 'string') {
                        return data;
                    }
                    try {
                        return JSON.parse(data);
                    } catch (_) {
                        return data;
                    }
                }

                function applyTwitterResize(data, source) {
                    const payload = data && data['twttr.embed'];
                    if (!payload || payload.method !== 'twttr.private.resize') {
                        return false;
                    }

                    const params = payload.params && payload.params[0];
                    const height = params && params.height;
                    if (typeof height !== 'number' || height <= 0) {
                        return false;
                    }

                    const tweetId = params.data && params.data.tweet_id;
                    const iframes = Array.from(document.querySelectorAll('iframe'));
                    const twitterIframes = iframes.filter(iframe => iframe.src.includes('platform.twitter.com'));
                    twitterIframes.forEach(iframe => {
                        const iframeTweetId = (iframe.src.match(/[?&]id=(\d+)/) || [])[1];
                        const matchesTweetId = tweetId && iframeTweetId && String(tweetId) === String(iframeTweetId);
                        if (matchesTweetId || iframe.contentWindow === source || twitterIframes.length === 1) {
                            iframe.style.setProperty('height', height + 'px', 'important');
                            const parent = iframe.parentElement;
                            if (parent) {
                                parent.style.height = 'auto';
                            }
                        }
                    });
                    return true;
                }

                window.addEventListener('message', function(e) {
                    const data = parseMessageData(e.data);
                    if (applyTwitterResize(data, e.source)) {
                        postHeight();
                        return;
                    }

                    if (data && (data.height || data.type === 'setHeight')) {
                        const height = data.height || data.value;
                        document.querySelectorAll('iframe').forEach(iframe => {
                            if (iframe.contentWindow === e.source) {
                                iframe.style.setProperty('height', height + 'px', 'important');
                                postHeight();
                            }
                        });
                    }
                });

                postHeight();
            </script>
        </body>
        </html>
    """.trimIndent()
}

internal fun sanitizeReaderHtml(html: String): String {
    if (!html.contains('<')) return html

    return html
        .replace(UNSAFE_BLOCK_TAG_REGEX, "")
        .replace(UNSAFE_VOID_TAG_REGEX, "")
        .replace(UNSAFE_EVENT_ATTRIBUTE_REGEX, "")
        .replace(UNSAFE_URL_ATTRIBUTE_REGEX, "")
        .replace(IFRAME_TAG_REGEX) { match ->
            val src = SRC_ATTRIBUTE_REGEX.find(match.value)
                ?.groups
                ?.get(2)
                ?.value
                ?.trim()
            if (isTrustedEmbedUrl(src)) match.value else ""
        }
}

internal const val DefaultReaderDocumentBaseUrl = "https://self-feed.local/"

internal fun readerDocumentBaseUrl(vararg candidates: String?): String {
    candidates.forEach { candidate ->
        val trimmed = candidate?.trim()?.takeIf { it.isNotBlank() } ?: return@forEach
        val uri = runCatching { URI(trimmed) }.getOrNull() ?: return@forEach
        val scheme = uri.scheme?.lowercase()
        if ((scheme == "https" || scheme == "http") && !uri.host.isNullOrBlank()) {
            return trimmed
        }
    }

    return DefaultReaderDocumentBaseUrl
}

private fun Color.toCssHex(): String =
    String.format(Locale.US, "#%06X", 0xFFFFFF and toArgb())

private val UNSAFE_BLOCK_TAG_REGEX = Regex(
    """<\s*(script|style|template|object|embed|applet|form|textarea|select)\b[^>]*>.*?<\s*/\s*\1\s*>""",
    setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL),
)

private val UNSAFE_VOID_TAG_REGEX = Regex(
    """<\s*(script|style|template|object|embed|applet|form|input|button|textarea|select)\b[^>]*?/?>""",
    RegexOption.IGNORE_CASE,
)

private val UNSAFE_EVENT_ATTRIBUTE_REGEX = Regex(
    """\s+on[a-zA-Z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)""",
    RegexOption.IGNORE_CASE,
)

private val UNSAFE_URL_ATTRIBUTE_REGEX = Regex(
    """\s+(href|src|poster)\s*=\s*("[^"]*(?:javascript:|vbscript:|data:text/html)[^"]*"|'[^']*(?:javascript:|vbscript:|data:text/html)[^']*'|[^\s>]*(?:javascript:|vbscript:|data:text/html)[^\s>]*)""",
    RegexOption.IGNORE_CASE,
)

private val IFRAME_TAG_REGEX = Regex(
    """<iframe\b[^>]*>(?:.*?</iframe>)?""",
    setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL),
)

private val SRC_ATTRIBUTE_REGEX = Regex(
    """\bsrc\s*=\s*(["'])(.*?)\1""",
    setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL),
)
