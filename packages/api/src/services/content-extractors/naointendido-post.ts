import { sanitizeHtml } from '../../utils/sanitizer.js';

interface NaointendidoPostMedia {
	type: string;
	content?: string;
}

export interface NaointendidoPost {
	media?: NaointendidoPostMedia;
	description?: string;
}

const POST_SLUG_REGEX = /\/posts\/([a-zA-Z0-9_-]+)/;
const BASE_URL = 'https://www.naointendo.com.br';
const SUPPORTED_HOSTS = new Set([
	'naointendido.com.br',
	'www.naointendido.com.br',
	'naointendo.com.br',
	'www.naointendo.com.br',
]);

export function canHandleNaointendidoPostUrl(url: string): boolean {
	try {
		const parsedUrl = new URL(url);
		return SUPPORTED_HOSTS.has(parsedUrl.hostname) && POST_SLUG_REGEX.test(parsedUrl.pathname);
	} catch {
		return false;
	}
}

export function buildNaointendidoApiUrl(url: string): string | null {
	if (!canHandleNaointendidoPostUrl(url)) return null;
	const match = url.match(POST_SLUG_REGEX);
	if (!match) return null;
	return `${BASE_URL}/api/posts/${match[1]}`;
}

export function parseNaointendidoPost(data: unknown): NaointendidoPost | null {
	if (!data || typeof data !== 'object') return null;

	const post = (data as { post?: unknown }).post;
	if (!post || typeof post !== 'object') return null;

	const rawPost = post as { media?: unknown; description?: unknown };
	const parsed: NaointendidoPost = {};

	if (typeof rawPost.description === 'string') {
		parsed.description = rawPost.description;
	}

	if (rawPost.media && typeof rawPost.media === 'object') {
		const media = rawPost.media as { type?: unknown; content?: unknown };
		if (typeof media.type === 'string') {
			parsed.media = {
				type: media.type,
				...(typeof media.content === 'string' ? { content: media.content } : {}),
			};
		}
	}

	return parsed.media || parsed.description ? parsed : null;
}

export function reconstructNaointendidoPostHtml(post: NaointendidoPost): string | null {
	let reconstructedHtml = '';

	if (post.media) {
		const content = post.media.content ?? '';
		if (post.media.type === 'image') {
			reconstructedHtml += `<img src="${escapeHtmlAttr(content)}" />`;
		} else if (post.media.type === 'twitter') {
			reconstructedHtml += `<iframe class="embedded-media embedded-media--x" src="https://platform.twitter.com/embed/Tweet.html?id=${escapeHtmlAttr(content)}"></iframe>`;
		} else if (post.media.type === 'video') {
			reconstructedHtml += `<video src="${escapeHtmlAttr(content)}" controls></video>`;
		} else {
			reconstructedHtml += sanitizeHtml(content);
		}
	}

	if (post.description) {
		reconstructedHtml += sanitizeHtml(post.description);
	}

	return reconstructedHtml || null;
}

function escapeHtmlAttr(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}
