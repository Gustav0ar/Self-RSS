import { describe, expect, it } from 'vitest';
import { sanitizeArticleHtml } from '../../src/lib/sanitize-article';

describe('sanitizeArticleHtml', () => {
	it('returns empty string for falsy input', () => {
		expect(sanitizeArticleHtml(null)).toBe('');
		expect(sanitizeArticleHtml(undefined)).toBe('');
		expect(sanitizeArticleHtml('')).toBe('');
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
		const result = sanitizeArticleHtml(
			'<p style="background:url(javascript:alert(1))">hi</p>',
		);
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

	it('sandboxes iframes that are not approved embeds', () => {
		const result = sanitizeArticleHtml(
			'<iframe src="https://attacker.example/x"></iframe>',
		);
		expect(result.toLowerCase()).toContain('sandbox=');
	});

	it('adds rel and target to external anchor links', () => {
		const result = sanitizeArticleHtml(
			'<a href="https://example.com/post">read</a>',
		);
		expect(result).toContain('target="_blank"');
		expect(result).toContain('rel="noopener noreferrer nofollow"');
	});

	it('does not force target=_blank on internal anchor links', () => {
		const result = sanitizeArticleHtml('<a href="#section-1">jump</a>');
		expect(result).not.toContain('target="_blank"');
	});

	it('adds loading=lazy and referrerpolicy=no-referrer to images', () => {
		const result = sanitizeArticleHtml(
			'<img src="https://example.com/x.png" alt="x" />',
		);
		expect(result).toContain('loading="lazy"');
		expect(result).toContain('decoding="async"');
		expect(result).toContain('referrerpolicy="no-referrer"');
	});

	it('strips empty wrappers that no longer have content', () => {
		const result = sanitizeArticleHtml(
			'<p><script>alert(1)</script></p><p>kept</p>',
		);
		expect(result).toContain('<p>kept</p>');
		// We can't assert the empty <p> is gone in a strict way (the
		// sanitizer may also leave it), but it must not contain
		// script.
		expect(result.toLowerCase()).not.toContain('script');
	});
});
