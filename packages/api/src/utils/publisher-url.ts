import { JSDOM, VirtualConsole } from 'jsdom';

const virtualConsole = new VirtualConsole();
const publisherDom = new JSDOM('', { virtualConsole });
const publisherDocument = publisherDom.window.document;

export function resolvePublisherUrl(
	rawValue: unknown,
	...baseCandidates: unknown[]
): string | null {
	if (typeof rawValue !== 'string' || !rawValue.trim()) return null;
	const raw = rawValue.trim();
	const bases = baseCandidates.flatMap((candidate) =>
		typeof candidate === 'string' && candidate.trim() ? [candidate.trim()] : [],
	);

	for (const base of [undefined, ...bases]) {
		try {
			const parsed = base == null ? new URL(raw) : new URL(raw, base);
			if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
		} catch {
			// Try the next publisher-provided base URL.
		}
	}
	return null;
}

export function resolvePublisherHtmlUrls(html: string, ...baseCandidates: unknown[]): string {
	if (!html.trim()) return html;
	const bases = baseCandidates.flatMap((candidate) =>
		typeof candidate === 'string' && candidate.trim() ? [candidate.trim()] : [],
	);
	// Reuse one lightweight parsing document. Constructing a JSDOM for every feed
	// item leaves a large native allocator footprint even after window.close().
	const template = publisherDocument.createElement('template');
	template.innerHTML = html;
	const urlAttributes = [
		'href',
		'src',
		'poster',
		'data-src',
		'data-lazy-src',
		'data-original',
		'data-original-src',
		'data-video-url',
		'data-embed-url',
	];

	try {
		for (const element of template.content.querySelectorAll('*')) {
			for (const attribute of urlAttributes) {
				if (!element.hasAttribute(attribute)) continue;
				const resolved = resolvePublisherUrl(element.getAttribute(attribute), ...bases);
				if (resolved) element.setAttribute(attribute, resolved);
				else element.removeAttribute(attribute);
			}
			for (const attribute of ['srcset', 'data-srcset', 'data-lazy-srcset']) {
				const value = element.getAttribute(attribute);
				if (!value) continue;
				const resolved = value
					.split(',')
					.map((entry) => {
						const [url, ...descriptor] = entry.trim().split(/\s+/);
						const absolute = resolvePublisherUrl(url, ...bases);
						return absolute ? [absolute, ...descriptor].join(' ') : null;
					})
					.filter((entry): entry is string => entry != null)
					.join(', ');
				if (resolved) element.setAttribute(attribute, resolved);
				else element.removeAttribute(attribute);
			}
		}

		return template.innerHTML;
	} finally {
		template.replaceChildren();
	}
}
