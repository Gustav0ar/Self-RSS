import { JSDOM, VirtualConsole } from 'jsdom';

const virtualConsole = new VirtualConsole();

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
	const document = new JSDOM(`<body>${html}</body>`, { virtualConsole }).window.document;
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

	for (const element of document.body.querySelectorAll('*')) {
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

	return document.body.innerHTML;
}
