import DOMPurify from 'dompurify';
import { JSDOM, VirtualConsole } from 'jsdom';

const virtualConsole = new VirtualConsole();
const window = new JSDOM('', { virtualConsole }).window;
const purify = DOMPurify(window);

const KNOWN_EMBED_HOSTS = new Set([
	'www.youtube.com',
	'youtube.com',
	'm.youtube.com',
	'youtu.be',
	'player.vimeo.com',
	'www.vimeo.com',
	'vimeo.com',
	'www.streamable.com',
	'streamable.com',
	'www.videopress.com',
	'videopress.com',
	'videos.files.wordpress.com',
	'videos.wordpress.com',
	'platform.twitter.com',
	'www.twitter.com',
	'twitter.com',
	'www.x.com',
	'x.com',
]);

const MEDIA_CONTENT_REGEX = /<(?:img|video|audio|picture|source|iframe)\b/i;
const MEDIA_EXTRACTION_CANDIDATE_REGEX = /<(?:img|iframe|video|source|a)\b/i;
const VIDEO_LOADER_PLACEHOLDER_PATH = 'load-video-on-click/assets/img/ajax-loader.gif';
const VIDEO_LOADER_PLACEHOLDER_TAG_REGEX = new RegExp(
	`<img[^>]+${VIDEO_LOADER_PLACEHOLDER_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*>`,
	'gi',
);
const SCRIPT_STYLE_TAG_REGEX = /<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi;
const TEXT_BOUNDARY_TAG_REGEX =
	/<\/?(?:address|article|aside|blockquote|br|dd|details|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi;
const HTML_TAG_REGEX = /<\/?[a-zA-Z][^>]*>/g;
const WHITESPACE_REGEX = /\s+/g;
const HTML_ENTITY_REGEX = /&(#\d+|#x[\da-f]+|[a-z][a-z0-9]+);/gi;
const IMG_TAG_REGEX = /<img\b[^>]*>/gi;
const HERO_IMAGE_ATTRS = ['src', 'data-src', 'data-lazy-src', 'data-original', 'data-original-src'];
const HERO_IMAGE_SRCSET_ATTRS = ['srcset', 'data-srcset', 'data-lazy-srcset'];
const NAMED_HTML_ENTITIES: Record<string, string> = {
	amp: '&',
	apos: "'",
	gt: '>',
	lt: '<',
	nbsp: ' ',
	quot: '"',
};

const TWITTER_STATUS_URL_REGEX =
	/https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[^\s"']+\/status\/(\d+)/i;

const ARTICLE_CHROME_SELECTORS = [
	'script',
	'style',
	'form',
	'noscript',
	'template',
	'img[src*="load-video-on-click/assets/img/ajax-loader.gif"]',
	'.code-block',
	'[class^="code-block"]',
	'.post-media-buttons',
	'.sharedaddy',
	'.sharedaddy-placeholder',
	'.sd-sharing',
	'.sd-like',
	'.jp-relatedposts',
	'.related-posts',
	'.yarpp-related',
	'.comments-area',
	'#comments',
	'.comment-respond',
	'.post-footer',
	'.post-footer-meta',
	'.author-box',
	'.author-bio',
	'.author-avatar',
	'.fb-like',
	'.tweet',
	'.pinterest',
	'.zap',
	'.telegram',
	'[class*="social-share"]',
	'[class*="share-buttons"]',
	'[class*="sharing"]',
	'[class*="comments"]',
	'[id*="comments"]',
].join(', ');

purify.addHook('uponSanitizeElement', (node, data) => {
	if (data.tagName === 'iframe') {
		const element = node as Element;
		const src = element.getAttribute('src') ?? '';
		try {
			const url = new URL(src, 'https://placeholder.invalid');
			if (!['https:', 'http:'].includes(url.protocol) || !toEmbedUrl(src)) {
				element.remove();
				return;
			}
			applyEmbedPresentationAttributes(element, src);
			element.setAttribute('loading', 'lazy');
			element.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
		} catch {
			element.remove();
		}
	}

	if (data.tagName === 'video' || data.tagName === 'audio' || data.tagName === 'source') {
		const element = node as Element;
		const src = element.getAttribute('src') ?? '';
		if (src) {
			try {
				const url = new URL(src, 'https://placeholder.invalid');
				if (!['https:', 'http:'].includes(url.protocol)) {
					element.remove();
				}
			} catch {
				element.remove();
			}
		}
	}
});

const SANITIZE_OPTIONS = {
	ALLOWED_TAGS: [
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
	],
	ALLOWED_ATTR: [
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
		'style',
	],
	FORBID_TAGS: [
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
	],
	FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur'],
	ADD_ATTR: ['target'],
};

function normalizeHtmlInput(value: unknown, seen = new Set<unknown>()): string {
	if (typeof value === 'string') {
		return value;
	}

	if (value == null) {
		return '';
	}

	if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
		return String(value);
	}

	if (Array.isArray(value)) {
		return value
			.map((item) => normalizeHtmlInput(item, seen))
			.filter(Boolean)
			.join(' ');
	}

	if (typeof value === 'object') {
		if (seen.has(value)) {
			return '';
		}

		seen.add(value);
		const normalized = Object.values(value as Record<string, unknown>)
			.map((item) => normalizeHtmlInput(item, seen))
			.filter(Boolean)
			.join(' ');
		seen.delete(value);
		return normalized;
	}

	return '';
}

export function sanitizeHtml(dirty: unknown): string {
	const normalizedHtml = normalizeHtmlInput(dirty);
	if (!normalizedHtml.includes('<')) {
		return normalizedHtml;
	}
	return purify.sanitize(normalizedHtml, SANITIZE_OPTIONS);
}

export function hasRichMedia(html: unknown): boolean {
	const normalizedHtml = normalizeHtmlInput(html);
	if (!normalizedHtml.trim()) return false;
	const cleanedHtml = normalizedHtml.replace(VIDEO_LOADER_PLACEHOLDER_TAG_REGEX, '');
	return MEDIA_CONTENT_REGEX.test(cleanedHtml) || cleanedHtml.includes('rll-youtube-player');
}

export function stripHtml(html: unknown): string {
	return decodeHtmlEntities(
		normalizeHtmlInput(html)
			.replace(SCRIPT_STYLE_TAG_REGEX, ' ')
			.replace(TEXT_BOUNDARY_TAG_REGEX, ' ')
			.replace(HTML_TAG_REGEX, ' '),
	)
		.replace(WHITESPACE_REGEX, ' ')
		.trim();
}

function decodeHtmlEntities(text: string): string {
	return text.replace(HTML_ENTITY_REGEX, (entity, code: string) => {
		const normalized = code.toLowerCase();
		const named = NAMED_HTML_ENTITIES[normalized];
		if (named) {
			return named;
		}

		const codePoint = normalized.startsWith('#x')
			? Number.parseInt(normalized.slice(2), 16)
			: normalized.startsWith('#')
				? Number.parseInt(normalized.slice(1), 10)
				: NaN;
		if (!Number.isFinite(codePoint)) {
			return entity;
		}

		try {
			return String.fromCodePoint(codePoint);
		} catch {
			return entity;
		}
	});
}

export function extractExcerpt(text: string, maxLength = 300): string {
	if (text.length <= maxLength) return text;
	const truncated = text.substring(0, maxLength);
	const lastSpace = truncated.lastIndexOf(' ');
	return `${lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated}...`;
}

function getTagAttribute(tag: string, attribute: string): string | null {
	const match = tag.match(
		new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'<>]+))`, 'i'),
	);
	const value = match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
	return value ? decodeHtmlEntities(value).trim() : null;
}

function normalizeHeroImageCandidate(value: string | null): string | null {
	if (!value) return null;
	const candidate = value.trim();
	if (!candidate || candidate.includes(VIDEO_LOADER_PLACEHOLDER_PATH)) {
		return null;
	}
	if (/^data:/i.test(candidate)) {
		return null;
	}
	try {
		const parsed = new URL(candidate, 'https://placeholder.invalid');
		if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
			return candidate.startsWith('//') ? parsed.toString() : candidate;
		}
	} catch {
		// Fall through to relative URL handling below.
	}
	if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
		return null;
	}
	return candidate;
}

function firstHeroImageFromSrcset(srcset: string | null): string | null {
	if (!srcset) return null;
	for (const entry of srcset.split(',')) {
		const candidate = entry.trim().split(/\s+/)[0] ?? null;
		const normalized = normalizeHeroImageCandidate(candidate);
		if (normalized) return normalized;
	}
	return null;
}

export function extractHeroImage(html: unknown): string | null {
	const normalizedHtml = normalizeHtmlInput(html);
	for (const match of normalizedHtml.matchAll(IMG_TAG_REGEX)) {
		const tag = match[0]!;
		for (const attribute of HERO_IMAGE_ATTRS) {
			const candidate = normalizeHeroImageCandidate(getTagAttribute(tag, attribute));
			if (candidate) return candidate;
		}
		for (const attribute of HERO_IMAGE_SRCSET_ATTRS) {
			const candidate = firstHeroImageFromSrcset(getTagAttribute(tag, attribute));
			if (candidate) return candidate;
		}
	}
	return null;
}

function promoteLazyAttribute(element: Element, attribute: 'src' | 'srcset' | 'poster') {
	if (element.getAttribute(attribute)) return;

	const lazyValue =
		element.getAttribute(`data-${attribute}`) ?? element.getAttribute(`data-lazy-${attribute}`);
	if (lazyValue) {
		element.setAttribute(attribute, lazyValue);
	}
}

function getProviderFromUrl(url: string): string {
	try {
		const hostname = new URL(url, 'https://placeholder.invalid').hostname
			.toLowerCase()
			.replace(/\.$/, '');
		if (KNOWN_EMBED_HOSTS.has(hostname)) {
			if (hostname.includes('youtube') || hostname === 'youtu.be') return 'youtube';
			if (hostname.includes('vimeo')) return 'vimeo';
			if (hostname.includes('streamable')) return 'streamable';
			if (hostname.includes('videopress') || hostname.includes('wordpress')) return 'videopress';
			if (hostname.includes('twitter') || hostname.endsWith('x.com')) return 'x';
		}
		return hostname.replace(/^www\./, '') || 'embed';
	} catch {
		return 'embed';
	}
}

function toEmbedUrl(url: string): { provider: string; embedUrl: string } | null {
	const parsed = parseHttpUrl(url);
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
		if (isProviderId(id, /^[a-zA-Z0-9_-]+$/)) {
			return { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${id}` };
		}
	}

	if (hostname === 'youtu.be') {
		const id = segments[0] ?? null;
		if (isProviderId(id, /^[a-zA-Z0-9_-]+$/)) {
			return { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${id}` };
		}
	}

	if (hostname === 'player.vimeo.com' && segments[0] === 'video') {
		const id = segments[1] ?? null;
		if (isProviderId(id, /^\d+$/)) {
			return { provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${id}` };
		}
	}

	if (['vimeo.com', 'www.vimeo.com'].includes(hostname)) {
		const id = segments[0] ?? null;
		if (isProviderId(id, /^\d+$/)) {
			return { provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${id}` };
		}
	}

	if (['streamable.com', 'www.streamable.com'].includes(hostname)) {
		const id = segments[0] === 'e' ? segments[1] : segments[0];
		if (isProviderId(id, /^[a-zA-Z0-9]+$/)) {
			return { provider: 'streamable', embedUrl: `https://streamable.com/e/${id}` };
		}
	}

	if (['videopress.com', 'www.videopress.com'].includes(hostname)) {
		const id = segments[0] === 'embed' || segments[0] === 'v' ? segments[1] : null;
		if (isProviderId(id, /^[a-zA-Z0-9]+$/)) {
			return { provider: 'videopress', embedUrl: `https://videopress.com/embed/${id}` };
		}
	}

	if (
		['videos.files.wordpress.com', 'videos.wordpress.com'].includes(hostname) &&
		segments.length > 0
	) {
		return { provider: 'videopress', embedUrl: parsed.toString() };
	}

	if (hostname === 'platform.twitter.com' && parsed.pathname === '/embed/Tweet.html') {
		const id = parsed.searchParams.get('id');
		if (isProviderId(id, /^\d+$/)) {
			return { provider: 'x', embedUrl: `https://platform.twitter.com/embed/Tweet.html?id=${id}` };
		}
	}
	return null;
}

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

function extractEmbedUrlFromInlineScript(scriptContent: string): string | null {
	const embedPatterns = [
		/\.src\s*=\s*["']([^"']+)["']/i,
		/src\s*:\s*["']([^"']+)["']/i,
		/["'](https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|player\.vimeo\.com|vimeo\.com|streamable\.com|videopress\.com|videos\.(?:files\.)?wordpress\.com)[^"'\s<]+)["']/i,
	];
	for (const pattern of embedPatterns) {
		const match = scriptContent.match(pattern);
		const candidate = match?.[1];
		if (!candidate) continue;
		const embedded = toEmbedUrl(candidate);
		if (embedded) {
			return embedded.embedUrl;
		}
	}
	return null;
}

function applyEmbedPresentationAttributes(element: Element, source: string) {
	const embedded = toEmbedUrl(source);
	const provider = embedded?.provider ?? getProviderFromUrl(source);
	const existingClass = element.getAttribute('class')?.trim();
	element.setAttribute(
		'class',
		[existingClass, 'embedded-media', `embedded-media--${provider}`].filter(Boolean).join(' '),
	);
	if (provider === 'x') {
		element.setAttribute('scrolling', 'no');
		element.setAttribute('style', 'overflow: hidden;');
	}
}

function parseDimension(value: string | null | undefined): number | null {
	if (!value) return null;
	const match = value.match(/\d+(?:\.\d+)?/);
	if (!match) return null;
	const parsed = Number.parseFloat(match[0]);
	return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function createEmbeddedIframe(
	root: Element,
	source: string,
	title: string,
	width?: string | null,
	height?: string | null,
) {
	const iframe = root.ownerDocument.createElement('iframe');
	iframe.setAttribute('src', source);
	iframe.setAttribute('title', title);
	iframe.setAttribute('frameborder', '0');
	iframe.setAttribute('allowfullscreen', 'allowfullscreen');
	if (parseDimension(width)) {
		iframe.setAttribute('width', String(parseDimension(width)));
	}
	if (parseDimension(height)) {
		iframe.setAttribute('height', String(parseDimension(height)));
	}
	applyEmbedPresentationAttributes(iframe, source);
	return iframe;
}

function removeVideoLoaderPlaceholders(root: Element) {
	for (const image of root.querySelectorAll('img')) {
		const src = image.getAttribute('src')?.trim() ?? '';
		if (!src.includes(VIDEO_LOADER_PLACEHOLDER_PATH)) {
			continue;
		}

		const container = image.closest('p, div, figure') ?? image.parentElement;
		const nearbyEmbed = container?.querySelector('iframe, video, source') ?? null;
		const nearbyLink =
			container?.querySelector(
				'a[href*="streamable.com"], a[href*="videopress.com"], a[href*="wordpress.com"]',
			) ?? null;
		if (!nearbyEmbed && !nearbyLink) {
			container?.remove();
		}
	}
}

function normalizeLazyMedia(root: Element) {
	for (const element of root.querySelectorAll('img, iframe, video, audio, source')) {
		promoteLazyAttribute(element, 'src');
		promoteLazyAttribute(element, 'srcset');
		promoteLazyAttribute(element, 'poster');
	}

	for (const element of root.querySelectorAll(
		'.rll-youtube-player[data-src], .rll-vimeo-player[data-src], .rll-video-player[data-src], [data-video-url], [data-embed-url], [data-src]',
	)) {
		const source =
			element.getAttribute('data-src')?.trim() ??
			element.getAttribute('data-video-url')?.trim() ??
			element.getAttribute('data-embed-url')?.trim();
		if (!source) continue;

		element.replaceWith(
			createEmbeddedIframe(
				root,
				source,
				element.getAttribute('data-alt') ?? element.getAttribute('title') ?? 'Embedded video',
			),
		);
	}

	for (const element of root.querySelectorAll(
		'div[class*="videopress"], figure[class*="videopress"], div[data-block-name="core/video"], div[class*="video_widget"], div[id$="-iframe"]',
	)) {
		const iframePlaceholder = element.querySelector('[id$="-iframe"]');
		const candidate =
			element.getAttribute('data-src')?.trim() ??
			element.getAttribute('data-url')?.trim() ??
			element.getAttribute('data-video-url')?.trim() ??
			element.querySelector('iframe')?.getAttribute('src')?.trim() ??
			element.querySelector('video source')?.getAttribute('src')?.trim() ??
			element.querySelector('video')?.getAttribute('src')?.trim() ??
			extractEmbedUrlFromInlineScript(element.innerHTML);
		const _width =
			element.getAttribute('width') ??
			iframePlaceholder?.getAttribute('width') ??
			element.querySelector('iframe')?.getAttribute('width') ??
			element.querySelector('video')?.getAttribute('width');
		const _height =
			element.getAttribute('height') ??
			iframePlaceholder?.getAttribute('height') ??
			element.querySelector('iframe')?.getAttribute('height') ??
			element.querySelector('video')?.getAttribute('height');
		if (!candidate) continue;

		const embedded = toEmbedUrl(candidate);
		if (embedded) {
			element.replaceWith(
				createEmbeddedIframe(
					root,
					embedded.embedUrl,
					element.getAttribute('title') ?? 'Embedded video',
				),
			);
		}
	}

	for (const link of root.querySelectorAll('a[href]')) {
		const href = link.getAttribute('href')?.trim();
		if (!href) continue;

		const parent = link.parentElement;
		const embedded = toEmbedUrl(href);
		if (
			embedded &&
			parent &&
			parent.childElementCount <= 2 &&
			(parent.textContent?.trim()?.length ?? 0) <= 140
		) {
			const iframe = root.ownerDocument.createElement('iframe');
			iframe.setAttribute('src', embedded.embedUrl);
			iframe.setAttribute('title', link.getAttribute('title') ?? 'Embedded video');
			iframe.setAttribute('frameborder', '0');
			iframe.setAttribute('allowfullscreen', 'allowfullscreen');
			applyEmbedPresentationAttributes(iframe, embedded.embedUrl);
			parent.replaceWith(iframe);
			continue;
		}

		const twitterMatch = href.match(TWITTER_STATUS_URL_REGEX);
		if (twitterMatch && parent && parent.childElementCount <= 2) {
			const blockquote = root.ownerDocument.createElement('blockquote');
			blockquote.setAttribute('class', 'twitter-tweet');
			const anchor = root.ownerDocument.createElement('a');
			anchor.setAttribute('href', href);
			anchor.textContent = href;
			blockquote.appendChild(anchor);
			parent.replaceWith(blockquote);
		}
	}
}

export function extractArticleContentFromPage(pageHtml: unknown): string | null {
	const normalizedHtml = normalizeHtmlInput(pageHtml);
	if (!normalizedHtml.trim()) return null;
	const document = new JSDOM(normalizedHtml, { virtualConsole }).window.document;
	const content = document.querySelector(
		'article .entry-content, article .post-content, .entry-content, .post-content',
	);

	if (!content) return null;

	const clone = content.cloneNode(true) as Element;
	normalizeLazyMedia(clone);
	removeVideoLoaderPlaceholders(clone);
	for (const iframe of clone.querySelectorAll('iframe')) {
		const src = iframe.getAttribute('src')?.trim() ?? '';
		if (!toEmbedUrl(src)) {
			iframe.remove();
		}
	}
	clone.querySelectorAll(ARTICLE_CHROME_SELECTORS).forEach((element) => {
		element.remove();
	});

	for (const element of clone.querySelectorAll('p, div, section, article')) {
		if (element.childElementCount > 0) continue;
		if (element.textContent?.trim()) continue;
		element.remove();
	}

	const html = clone.innerHTML.trim();
	return html || null;
}

export function extractMediaFromHtml(html: unknown) {
	const normalizedHtml = normalizeHtmlInput(html);
	if (!normalizedHtml.trim() || !MEDIA_EXTRACTION_CANDIDATE_REGEX.test(normalizedHtml)) {
		return [];
	}
	const media: {
		type: string;
		provider: string;
		url: string;
		embedUrl: string | null;
		width: number | null;
		height: number | null;
		position: number;
	}[] = [];
	let position = 0;

	// Extract images
	const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
	for (const imgMatch of normalizedHtml.matchAll(imgRegex)) {
		const widthMatch = imgMatch[0]!.match(/width=["']?(\d+)/);
		const heightMatch = imgMatch[0]!.match(/height=["']?(\d+)/);
		media.push({
			type: 'image',
			provider: 'unknown',
			url: imgMatch[1]!,
			embedUrl: null,
			width: widthMatch ? Number.parseInt(widthMatch[1]!, 10) : null,
			height: heightMatch ? Number.parseInt(heightMatch[1]!, 10) : null,
			position: position++,
		});
	}

	// Extract embeds
	const iframeRegex = /<iframe[^>]+src=["']([^"']+)["'][^>]*>/gi;
	for (const iframeMatch of normalizedHtml.matchAll(iframeRegex)) {
		const src = iframeMatch[1]!;
		const embedded = toEmbedUrl(src);
		if (embedded) {
			const widthMatch = iframeMatch[0]!.match(/width=["']?(\d+)/i);
			const heightMatch = iframeMatch[0]!.match(/height=["']?(\d+)/i);
			media.push({
				type: 'embed',
				provider: embedded.provider,
				url: src,
				embedUrl: embedded.embedUrl,
				width: widthMatch ? Number.parseInt(widthMatch[1]!, 10) : null,
				height: heightMatch ? Number.parseInt(heightMatch[1]!, 10) : null,
				position: position++,
			});
		}
	}

	const videoRegex = /<(video|source)[^>]+src=["']([^"']+)["'][^>]*>/gi;
	for (const videoMatch of normalizedHtml.matchAll(videoRegex)) {
		const src = videoMatch[2]!;
		const embedded = toEmbedUrl(src);
		media.push({
			type: videoMatch[1] === 'video' ? 'video' : embedded ? 'embed' : 'video',
			provider: embedded?.provider ?? getProviderFromUrl(src),
			url: src,
			embedUrl: embedded?.embedUrl ?? null,
			width: null,
			height: null,
			position: position++,
		});
	}

	const anchorRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
	for (const anchorMatch of normalizedHtml.matchAll(anchorRegex)) {
		const href = anchorMatch[1]!;
		const embedded = toEmbedUrl(href);
		if (embedded) {
			media.push({
				type: 'embed',
				provider: embedded.provider,
				url: href,
				embedUrl: embedded.embedUrl,
				width: null,
				height: null,
				position: position++,
			});
		}
	}

	return media;
}
