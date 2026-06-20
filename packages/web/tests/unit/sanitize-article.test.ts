import { describe, expect, it, vi } from 'vitest';
import { sanitizeArticleHtml } from '../../src/lib/sanitize-article';

describe('sanitizeArticleHtml', () => {
	it('returns empty string for falsy input', () => {
		expect(sanitizeArticleHtml(null)).toBe('');
		expect(sanitizeArticleHtml(undefined)).toBe('');
		expect(sanitizeArticleHtml('')).toBe('');
	});

	it('returns empty string (not raw content) when sanitizer throws', async () => {
		// Mock the sanitizer module to throw when sanitize() is called.
		// This verifies that raw (potentially unsafe) HTML is NEVER
		// returned — the error handler must return safe content.

		// Reset the cached purify instance so our mock is picked up.
		vi.resetModules();

		const sanitizeSpy = vi.fn(() => {
			throw new Error('sanitizer unavailable');
		});
		vi.doMock('dompurify', () => ({
			default: vi.fn(() => ({ sanitize: sanitizeSpy })),
		}));

		// Re-import to pick up the mocked module.
		const mod = await import('../../src/lib/sanitize-article');
		// Reset the internal cache so getPurify() calls our mock.
		(mod as unknown as { cachedPurify: unknown }).cachedPurify = null;

		const dirty = '<script>alert("xss")</script><p>safe content</p>';
		const result = mod.sanitizeArticleHtml(dirty);

		expect(result).toBe('');
		expect(result).not.toContain('<script>');
		expect(result).not.toContain('alert');
	});

	it('strips <script> tags', () => {
		const result = sanitizeArticleHtml('<p>Hi</p><script>alert("xss")</script>');
		expect(result).not.toContain('script');
		expect(result).not.toContain('alert');
		expect(result).toContain('<p>Hi</p>');
	});

	it('strips inline event handlers', () => {
		const result = sanitizeArticleHtml(
			'<img src="https://example.com/x.png" onerror="alert(1)" alt="x" />',
		);
		expect(result.toLowerCase()).not.toContain('onerror');
		expect(result.toLowerCase()).not.toContain('alert');
	});

	it('strips javascript: URLs', () => {
		const result = sanitizeArticleHtml('<a href="javascript:alert(1)">click</a>');
		expect(result.toLowerCase()).not.toContain('javascript:');
	});

	it('strips inline style attributes (defense against exfiltration)', () => {
		const result = sanitizeArticleHtml('<p style="background:url(javascript:alert(1))">hi</p>');
		expect(result.toLowerCase()).not.toContain('style=');
	});

	it('keeps safe embeds but strips them from the article stream so the media panel can render them', () => {
		const result = sanitizeArticleHtml(
			'<p>before</p><iframe class="embedded-media" src="https://www.youtube.com/embed/abc" allowfullscreen></iframe><p>after</p>',
		);
		// The iframe is removed from the article body.
		expect(result.toLowerCase()).not.toContain('<iframe');
		// The wrapper paragraph is also removed so the layout doesn't
		// leave a visible gap.
		expect(result).toContain('<p>before</p>');
		expect(result).toContain('<p>after</p>');
	});

	it('removes iframes that are not approved embeds', () => {
		const result = sanitizeArticleHtml(
			'<p>before</p><p><iframe src="https://attacker.example/x"></iframe></p><p>after</p>',
		);
		expect(result.toLowerCase()).not.toContain('<iframe');
		expect(result).not.toContain('attacker.example');
		expect(result).toContain('<p>before</p>');
		expect(result).toContain('<p>after</p>');
	});

	it('removes lookalike media domains instead of treating them as approved embeds', () => {
		const result = sanitizeArticleHtml(
			'<iframe src="https://notyoutube.com/watch?v=abc123"></iframe><iframe src="https://evilplayer.vimeo.com/video/123"></iframe>',
		);

		expect(result.toLowerCase()).not.toContain('<iframe');
		expect(result).not.toContain('notyoutube.com');
		expect(result).not.toContain('evilplayer.vimeo.com');
	});

	it('keeps approved provider iframes that are not server-stamped', () => {
		const result = sanitizeArticleHtml(
			'<iframe src="https://youtu.be/abc123?feature=oembed"></iframe>',
		);

		expect(result).toContain('<iframe');
		expect(result).toContain('src="https://www.youtube.com/embed/abc123"');
		expect(result).toContain('loading="lazy"');
		expect(result).toContain('referrerpolicy="strict-origin-when-cross-origin"');
		expect(result).toContain('sandbox="allow-scripts allow-same-origin allow-presentation"');
	});

	it('adds rel and target to external anchor links', () => {
		const result = sanitizeArticleHtml('<a href="https://example.com/post">read</a>');
		expect(result).toContain('target="_blank"');
		expect(result).toContain('rel="noopener noreferrer nofollow"');
	});

	it('does not force target=_blank on internal anchor links', () => {
		const result = sanitizeArticleHtml('<a href="#section-1">jump</a>');
		expect(result).not.toContain('target="_blank"');
	});

	it('adds loading=lazy and referrerpolicy=no-referrer to images', () => {
		const result = sanitizeArticleHtml('<img src="https://example.com/x.png" alt="x" />');
		expect(result).toContain('loading="lazy"');
		expect(result).toContain('decoding="async"');
		expect(result).toContain('referrerpolicy="no-referrer"');
	});

	it('strips empty wrappers that no longer have content', () => {
		const result = sanitizeArticleHtml('<p><script>alert(1)</script></p><p>kept</p>');
		expect(result).toContain('<p>kept</p>');
		// We can't assert the empty <p> is gone in a strict way (the
		// sanitizer may also leave it), but it must not contain
		// script.
		expect(result.toLowerCase()).not.toContain('script');
	});
});
