import DOMPurify from 'dompurify';
import { JSDOM, VirtualConsole } from 'jsdom';

const virtualConsole = new VirtualConsole();
const window = new JSDOM('', { virtualConsole }).window;
const purify = DOMPurify(window);

const KNOWN_EMBED_HOSTS = [
	'www.youtube.com',
	'youtube.com',
	'player.vimeo.com',
	'streamable.com',
	'videopress.com',
	'videos.files.wordpress.com',
	'videos.wordpress.com',
	'platform.twitter.com',
	'twitter.com',
	'x.com',
];

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

export function extractHeroImage(html: unknown): string | null {
	const match = normalizeHtmlInput(html).match(/<img[^>]+src=["']([^"']+)["']/i);
	return match?.[1] ?? null;
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
		const hostname = new URL(url, 'https://placeholder.invalid').hostname.toLowerCase();
		const knownHost = KNOWN_EMBED_HOSTS.find(
			(host) => hostname === host || hostname.endsWith(`.${host}`),
		);
		if (knownHost) {
			if (knownHost.includes('youtube')) return 'youtube';
			if (knownHost.includes('vimeo')) return 'vimeo';
			if (knownHost.includes('streamable')) return 'streamable';
			if (knownHost.includes('videopress') || knownHost.includes('wordpress')) return 'videopress';
			if (knownHost.includes('twitter') || knownHost.includes('x.com')) return 'x';
		}
		return hostname.replace(/^www\./, '') || 'embed';
	} catch {
		return 'embed';
	}
}

function toEmbedUrl(url: string): { provider: string; embedUrl: string } | null {
	for (const pattern of EMBED_PATTERNS) {
		const match = url.match(pattern.regex);
		if (match) {
			return { provider: pattern.provider, embedUrl: pattern.toEmbed(match) };
		}
	}
	return null;
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

const EMBED_PATTERNS: {
	regex: RegExp;
	provider: string;
	toEmbed: (match: RegExpMatchArray) => string;
}[] = [
	{
		regex: /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/,
		provider: 'youtube',
		toEmbed: (m) => `https://www.youtube.com/embed/${m[1]}`,
	},
	{
		regex: /player\.vimeo\.com\/video\/(\d+)|vimeo\.com\/(\d+)/,
		provider: 'vimeo',
		toEmbed: (m) => `https://player.vimeo.com/video/${m[1] ?? m[2]}`,
	},
	{
		regex: /streamable\.com\/(?:e\/)?([a-zA-Z0-9]+)/,
		provider: 'streamable',
		toEmbed: (m) => `https://streamable.com/e/${m[1]}`,
	},
	{
		regex: /videopress\.com\/(?:embed\/|v\/)([a-zA-Z0-9]+)/,
		provider: 'videopress',
		toEmbed: (m) => `https://videopress.com/embed/${m[1]}`,
	},
	{
		regex: /videos\.(?:files\.)?wordpress\.com\/[^"'\s]+/,
		provider: 'videopress',
		toEmbed: (m) => m[0],
	},
	{
		regex: /platform\.twitter\.com\/embed\/Tweet\.html\?(?:[^"'\s>]*&)?id=(\d+)/i,
		provider: 'x',
		toEmbed: (m) => `https://platform.twitter.com/embed/Tweet.html?id=${m[1]}`,
	},
];

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
