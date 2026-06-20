import DOMPurify from 'dompurify';

/**
 * Defense-in-depth sanitization for article HTML on the client.
 *
 * The API already runs DOMPurify over every `contentHtml` it stores
 * (see `packages/api/src/utils/sanitizer.ts`), so the markup we render
 * is expected to be safe. This module re-sanitizes on the client so the
 * web app stays safe even if the server is bypassed, downgraded, or
 * fed a payload that bypasses the API sanitizer (e.g. through a future
 * client that writes directly to the DB).
 *
 * The allowlist mirrors the API's allowlist so the two layers agree on
 * what the reader is allowed to display. Update both together if you
 * intentionally change the surface.
 */

const ALLOWED_TAGS = [
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'p',
	'br',
	'hr',
	'ul',
	'ol',
	'li',
	'blockquote',
	'pre',
	'code',
	'a',
	'strong',
	'em',
	'b',
	'i',
	'u',
	's',
	'del',
	'ins',
	'mark',
	'img',
	'figure',
	'figcaption',
	'picture',
	'source',
	'video',
	'audio',
	'table',
	'thead',
	'tbody',
	'tr',
	'th',
	'td',
	'div',
	'span',
	'section',
	'article',
	'iframe',
	'sub',
	'sup',
	'small',
	'abbr',
	'details',
	'summary',
];

const ALLOWED_ATTR = [
	'href',
	'src',
	'alt',
	'title',
	'width',
	'height',
	'class',
	'id',
	'target',
	'rel',
	'loading',
	'decoding',
	'srcset',
	'sizes',
	'type',
	'media',
	'controls',
	'preload',
	'poster',
	'frameborder',
	'allowfullscreen',
	'allow',
	'open',
	'scrolling',
];

const FORBID_TAGS = [
	'script',
	'style',
	'form',
	'input',
	'textarea',
	'button',
	'select',
	'object',
	'embed',
	'applet',
];

const FORBID_ATTR = [
	'onerror',
	'onclick',
	'onload',
	'onmouseover',
	'onfocus',
	'onblur',
	'onmouseout',
	'onmouseenter',
	'onmouseleave',
	'onkeydown',
	'onkeyup',
	'onkeypress',
	'onsubmit',
	'onchange',
	'oninput',
	// `style` is intentionally excluded even though the API allows it.
	// Inline styles are an exfiltration / layout-drift vector in the
	// reader, and the visual surface is fully covered by the design
	// system. Drop this if you need inline styles for a specific embed.
	'style',
];

const SANITIZE_OPTIONS = {
	ALLOWED_TAGS,
	ALLOWED_ATTR,
	FORBID_TAGS,
	FORBID_ATTR,
	ADD_ATTR: ['target'],
	// Block any URL scheme that isn't http/https/mailto. The API allows
	// the same. `data:` and `javascript:` are the two vectors that
	// matter most for stored XSS.
	ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

let cachedPurify: ReturnType<typeof DOMPurify> | null = null;

function parseHttpUrl(rawUrl: string): URL | null {
	try {
		const parsed = new URL(rawUrl.trim(), 'https://placeholder.invalid');
		if (parsed.hostname === 'placeholder.invalid') {
			return null;
		}
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

function isProviderId(value: string | null | undefined, pattern: RegExp): value is string {
	return Boolean(value && value.length <= 128 && pattern.test(value));
}

function getApprovedEmbedUrl(rawUrl: string): string | null {
	const parsed = parseHttpUrl(rawUrl);
	if (!parsed) {
		return null;
	}

	const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
	const segments = parsed.pathname.split('/').filter(Boolean);

	if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(hostname)) {
		const id =
			segments[0] === 'watch'
				? parsed.searchParams.get('v')
				: segments[0] === 'embed' || segments[0] === 'shorts'
					? segments[1]
					: null;
		return isProviderId(id, /^[a-zA-Z0-9_-]+$/) ? `https://www.youtube.com/embed/${id}` : null;
	}

	if (hostname === 'youtu.be') {
		const id = segments[0] ?? null;
		return isProviderId(id, /^[a-zA-Z0-9_-]+$/) ? `https://www.youtube.com/embed/${id}` : null;
	}

	if (hostname === 'player.vimeo.com' && segments[0] === 'video') {
		const id = segments[1] ?? null;
		return isProviderId(id, /^\d+$/) ? `https://player.vimeo.com/video/${id}` : null;
	}

	if (['vimeo.com', 'www.vimeo.com'].includes(hostname)) {
		const id = segments[0] ?? null;
		return isProviderId(id, /^\d+$/) ? `https://player.vimeo.com/video/${id}` : null;
	}

	if (['streamable.com', 'www.streamable.com'].includes(hostname)) {
		const id = segments[0] === 'e' ? segments[1] : segments[0];
		return isProviderId(id, /^[a-zA-Z0-9]+$/) ? `https://streamable.com/e/${id}` : null;
	}

	if (['videopress.com', 'www.videopress.com'].includes(hostname)) {
		const id = segments[0] === 'embed' || segments[0] === 'v' ? segments[1] : null;
		return isProviderId(id, /^[a-zA-Z0-9]+$/) ? `https://videopress.com/embed/${id}` : null;
	}

	if (
		['videos.files.wordpress.com', 'videos.wordpress.com'].includes(hostname) &&
		segments.length > 0
	) {
		parsed.protocol = 'https:';
		return parsed.toString();
	}

	if (hostname === 'platform.twitter.com' && parsed.pathname === '/embed/Tweet.html') {
		const id = parsed.searchParams.get('id');
		return isProviderId(id, /^\d+$/)
			? `https://platform.twitter.com/embed/Tweet.html?id=${id}`
			: null;
	}

	return null;
}

function removeIframeAndEmptyParent(iframe: HTMLIFrameElement) {
	const parent = iframe.parentElement;
	iframe.remove();
	if (
		parent &&
		['P', 'DIV', 'FIGURE', 'SECTION', 'ARTICLE'].includes(parent.tagName) &&
		parent.childElementCount === 0 &&
		!parent.textContent?.trim()
	) {
		parent.remove();
	}
}

function getPurify(): ReturnType<typeof DOMPurify> {
	if (cachedPurify) return cachedPurify;
	// In the browser, DOMPurify uses the global `window`. In a non-DOM
	// test environment it returns a stub that throws — guard with a
	// feature check so tests that don't mount jsdom can still import
	// this module.
	if (typeof window === 'undefined' || typeof document === 'undefined') {
		throw new Error('sanitizeArticleHtml requires a DOM environment');
	}
	cachedPurify = DOMPurify(window);
	return cachedPurify;
}

/**
 * Apply presentation attributes the reader expects: lazy images, safe
 * cross-origin defaults on iframes, and `noopener noreferrer` on
 * outbound links. Run AFTER DOMPurify so the sanitizer's output
 * survives the round-trip.
 */
function hardenRenderedHtml(html: string): string {
	if (typeof DOMParser === 'undefined') return html;

	const doc = new DOMParser().parseFromString(html, 'text/html');

	for (const img of doc.querySelectorAll('img')) {
		img.setAttribute('loading', 'lazy');
		img.setAttribute('decoding', 'async');
		img.setAttribute('referrerpolicy', 'no-referrer');
	}

	for (const video of doc.querySelectorAll('video')) {
		video.setAttribute('preload', 'metadata');
		video.setAttribute('referrerpolicy', 'no-referrer');
	}

	for (const source of doc.querySelectorAll('source')) {
		source.setAttribute('referrerpolicy', 'no-referrer');
	}

	for (const iframe of doc.querySelectorAll('iframe')) {
		// `embedded-media` is a class the server's sanitizer stamps on
		// approved embeds. The reader surfaces these in a dedicated
		// media panel below the body, so we strip them from the main
		// content stream here and let the panel re-render them from
		// the `article.media` array.
		if (iframe.classList.contains('embedded-media')) {
			removeIframeAndEmptyParent(iframe);
			continue;
		}

		const embedUrl = getApprovedEmbedUrl(iframe.getAttribute('src') ?? '');
		if (!embedUrl) {
			removeIframeAndEmptyParent(iframe);
			continue;
		}

		iframe.setAttribute('src', embedUrl);
		iframe.setAttribute('loading', 'lazy');
		iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
		iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
	}

	for (const anchor of doc.querySelectorAll('a[href]')) {
		const href = anchor.getAttribute('href') ?? '';
		// Only force external `target=_blank` to be safe; internal
		// anchor links should stay in the SPA.
		if (/^https?:\/\//i.test(href)) {
			anchor.setAttribute('target', '_blank');
			anchor.setAttribute('rel', 'noopener noreferrer nofollow');
		}
	}

	// Strip empty wrappers the API may have left behind around iframes
	// it removed, otherwise they leave visible gaps in the layout.
	for (const empty of doc.querySelectorAll('p, div, figure, section, article')) {
		if (!empty.textContent?.trim() && !empty.querySelector('img, video, audio, iframe, picture')) {
			empty.remove();
		}
	}

	return doc.body.innerHTML;
}

/**
 * Sanitize and harden article HTML for safe rendering. The input is
 * expected to already be sanitized by the API; this is a defense-in-
 * depth pass that re-validates the markup against the same allowlist
 * and adds client-side presentation attributes.
 */
export function sanitizeArticleHtml(dirty: string | null | undefined): string {
	if (!dirty) return '';
	let cleaned: string;
	try {
		cleaned = getPurify().sanitize(dirty, SANITIZE_OPTIONS) as string;
	} catch {
		// If the sanitizer throws unexpectedly (e.g. malformed input,
		// internal error), return an empty string rather than the raw
		// content. The server's guarantee means the input is expected
		// to be safe, but a sanitizer failure is not the same as
		// "safe by guarantee" — the safest response is to show nothing.
		return '';
	}
	return hardenRenderedHtml(cleaned);
}
