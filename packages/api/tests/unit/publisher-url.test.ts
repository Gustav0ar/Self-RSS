import { describe, expect, it } from 'vitest';
import { resolvePublisherHtmlUrls, resolvePublisherUrl } from '../../src/utils/publisher-url.js';

describe('resolvePublisherUrl', () => {
	it('resolves root-relative, path-relative, and protocol-relative publisher URLs', () => {
		expect(resolvePublisherUrl('/story', 'https://news.example.com/section/feed.xml')).toBe(
			'https://news.example.com/story',
		);
		expect(resolvePublisherUrl('../media/hero.jpg', 'https://news.example.com/section/story')).toBe(
			'https://news.example.com/media/hero.jpg',
		);
		expect(resolvePublisherUrl('//cdn.example.com/hero.jpg', 'https://news.example.com')).toBe(
			'https://cdn.example.com/hero.jpg',
		);
	});

	it('rejects non-web and malformed URLs even when a base is available', () => {
		expect(resolvePublisherUrl('javascript:alert(1)', 'https://news.example.com')).toBeNull();
		expect(resolvePublisherUrl('data:text/html,unsafe', 'https://news.example.com')).toBeNull();
		expect(resolvePublisherUrl('mailto:editor@example.com', 'https://news.example.com')).toBeNull();
		expect(resolvePublisherUrl('http://[invalid')).toBeNull();
	});
});

describe('resolvePublisherHtmlUrls', () => {
	it('normalizes links, media, lazy attributes, and srcset candidates', () => {
		const html = resolvePublisherHtmlUrls(
			`<a href="/about">About</a>
			<img src="../media/hero.jpg"
				data-lazy-src="//cdn.example.com/lazy.jpg"
				srcset="../media/small.jpg 480w, /media/large.jpg 960w">`,
			'https://news.example.com/section/story',
		);

		expect(html).toContain('href="https://news.example.com/about"');
		expect(html).toContain('src="https://news.example.com/media/hero.jpg"');
		expect(html).toContain('data-lazy-src="https://cdn.example.com/lazy.jpg"');
		expect(html).toContain(
			'srcset="https://news.example.com/media/small.jpg 480w, https://news.example.com/media/large.jpg 960w"',
		);
	});

	it('removes unsafe URL attributes while preserving safe content', () => {
		const html = resolvePublisherHtmlUrls(
			'<a href="javascript:alert(1)">Unsafe</a><img src="data:image/svg+xml,bad">',
			'https://news.example.com/story',
		);

		expect(html).toContain('>Unsafe</a>');
		expect(html).not.toContain('href=');
		expect(html).not.toContain('src=');
		expect(html).not.toContain('javascript:');
		expect(html).not.toContain('data:image');
	});
});
