import { describe, expect, it } from 'vitest';
import {
	extractArticleContentFromPage,
	extractExcerpt,
	extractHeroImage,
	extractMediaFromHtml,
	hasRichMedia,
	sanitizeHtml,
	stripHtml,
} from '../../src/utils/sanitizer.js';

describe('sanitizeHtml', () => {
	it('removes script tags', () => {
		const result = sanitizeHtml('<p>Hello</p><script>alert("xss")</script>');
		expect(result).not.toContain('script');
		expect(result).toContain('<p>Hello</p>');
	});

	it('coerces malformed object payloads into plain text instead of throwing', () => {
		const payload = Object.assign(Object.create(null), {
			summary: '<p>Hello</p>',
			trailing: '<script>alert(1)</script>',
		});

		const result = sanitizeHtml(payload);

		expect(result).toContain('<p>Hello</p>');
		expect(result).not.toContain('<script>');
	});

	it('removes event handlers', () => {
		const result = sanitizeHtml('<img src="test.jpg" onerror="alert(1)" />');
		expect(result).not.toContain('onerror');
	});

	it('preserves allowed tags', () => {
		const html =
			'<h1>Title</h1><p>Text with <strong>bold</strong></p><a href="http://example.com">link</a>';
		const result = sanitizeHtml(html);
		expect(result).toContain('<h1>');
		expect(result).toContain('<strong>');
		expect(result).toContain('href="http://example.com"');
	});

	it('preserves images with src', () => {
		const result = sanitizeHtml('<img src="https://example.com/img.jpg" alt="test" />');
		expect(result).toContain('src="https://example.com/img.jpg"');
	});
});

describe('stripHtml', () => {
	it('strips all HTML tags', () => {
		expect(stripHtml('<p>Hello <b>World</b></p>')).toBe('Hello World');
	});

	it('handles null-prototype objects without throwing', () => {
		const payload = Object.assign(Object.create(null), {
			content: '<p>Hello <b>World</b></p>',
		});

		expect(stripHtml(payload)).toBe('Hello World');
	});

	it('drops script/style content and decodes common entities', () => {
		expect(
			stripHtml('<style>.x{color:red}</style><p>AT&amp;T&nbsp;News</p><script>alert(1)</script>'),
		).toBe('AT&T News');
	});
});

describe('extractExcerpt', () => {
	it('returns full text if under limit', () => {
		expect(extractExcerpt('Short text')).toBe('Short text');
	});

	it('truncates at word boundary', () => {
		const long = 'word '.repeat(100);
		const result = extractExcerpt(long, 50);
		expect(result.length).toBeLessThanOrEqual(54);
		expect(result.endsWith('...')).toBe(true);
	});
});

describe('extractHeroImage', () => {
	it('extracts first image src', () => {
		const html = '<p>Text</p><img src="https://example.com/hero.jpg" /><img src="second.jpg" />';
		expect(extractHeroImage(html)).toBe('https://example.com/hero.jpg');
	});

	it('returns null when no image', () => {
		expect(extractHeroImage('<p>No images</p>')).toBeNull();
	});
});

describe('extractMediaFromHtml', () => {
	it('extracts images', () => {
		const html = '<img src="img1.jpg" width="800" height="600" />';
		const media = extractMediaFromHtml(html);
		expect(media).toHaveLength(1);
		expect(media[0]!.type).toBe('image');
		expect(media[0]!.url).toBe('img1.jpg');
		expect(media[0]!.width).toBe(800);
	});

	it('extracts YouTube embeds', () => {
		const html = '<iframe src="https://www.youtube.com/embed/abc123"></iframe>';
		const media = extractMediaFromHtml(html);
		expect(media).toHaveLength(1);
		expect(media[0]!.type).toBe('embed');
		expect(media[0]!.provider).toBe('youtube');
		expect(media[0]!.embedUrl).toBe('https://www.youtube.com/embed/abc123');
	});

	it('normalizes VideoPress watch URLs into embed URLs', () => {
		const html =
			'<iframe width="560" height="996" src="https://videopress.com/v/bskzi1r2?autoplay=1&loop=1"></iframe>';
		const media = extractMediaFromHtml(html);
		expect(media).toHaveLength(1);
		expect(media[0]!.type).toBe('embed');
		expect(media[0]!.provider).toBe('videopress');
		expect(media[0]!.embedUrl).toBe('https://videopress.com/embed/bskzi1r2');
		expect(media[0]!.width).toBe(560);
		expect(media[0]!.height).toBe(996);
	});

	it('recognizes platform twitter embeds', () => {
		const html =
			'<iframe src="https://platform.twitter.com/embed/Tweet.html?id=2057476717095113156"></iframe>';
		const media = extractMediaFromHtml(html);
		expect(media).toHaveLength(1);
		expect(media[0]!.type).toBe('embed');
		expect(media[0]!.provider).toBe('x');
		expect(media[0]!.embedUrl).toBe(
			'https://platform.twitter.com/embed/Tweet.html?id=2057476717095113156',
		);
	});

	it('does not treat ordinary article links as embeds', () => {
		const html = '<p><a href="https://www.ahnegao.com.br/2026/05/post.html">Leia mais</a></p>';
		const media = extractMediaFromHtml(html);
		expect(media).toHaveLength(0);
	});
});

describe('hasRichMedia', () => {
	it('detects standard media tags and lazy embed placeholders', () => {
		expect(hasRichMedia('<p><img src="https://example.com/a.jpg" /></p>')).toBe(true);
		expect(
			hasRichMedia(
				'<div class="rll-youtube-player" data-src="https://www.youtube.com/embed/abc"></div>',
			),
		).toBe(true);
		expect(hasRichMedia('<p>Only text</p>')).toBe(false);
	});

	it('does not treat the video loader spinner as real media', () => {
		expect(
			hasRichMedia(
				'<p><img src="/wp-content/plugins/load-video-on-click/assets/img/ajax-loader.gif" /></p>',
			),
		).toBe(false);
	});
});

describe('extractArticleContentFromPage', () => {
	it('replaces lazy loader placeholders and provider links with embeds', () => {
		const html = `
			<!doctype html>
			<html>
				<body>
					<article>
						<div class="entry-content">
							<img src="/wp-content/plugins/load-video-on-click/assets/img/ajax-loader.gif" />
							<p><a href="https://streamable.com/e/xyz123">Watch video</a></p>
						</div>
					</article>
				</body>
			</html>
		`;

		const result = extractArticleContentFromPage(html);

		expect(result).toContain('iframe');
		expect(result).toContain('https://streamable.com/e/xyz123');
		expect(result).not.toContain('ajax-loader.gif');
	});

	it('removes orphaned video loader placeholders when no playable media survives', () => {
		const html = `
			<!doctype html>
			<html>
				<body>
					<article>
						<div class="entry-content">
							<p><img src="/wp-content/plugins/load-video-on-click/assets/img/ajax-loader.gif" /></p>
							<p>Fallback text after the missing embed.</p>
						</div>
					</article>
				</body>
			</html>
		`;

		const result = extractArticleContentFromPage(html);

		expect(result).not.toContain('ajax-loader.gif');
		expect(result).toContain('Fallback text after the missing embed.');
	});

	it('removes non-embed article iframes while preserving the rest of the article body', () => {
		const html = `
			<!doctype html>
			<html>
				<body>
					<article>
						<div class="entry-content">
							<p>Intro</p>
							<iframe src="https://www.androidauthority.com/youtubes-recommendations-feel-worse-in-2026-but-these-5-simple-tricks-fixed-mine-3747747/"></iframe>
							<p>Outro</p>
						</div>
					</article>
				</body>
			</html>
		`;

		const result = extractArticleContentFromPage(html);
		const media = extractMediaFromHtml(result);

		expect(result).toContain('<p>Intro</p>');
		expect(result).toContain('<p>Outro</p>');
		expect(result).not.toContain('androidauthority.com');
		expect(result).not.toContain('<iframe');
		expect(media).toHaveLength(0);
	});

	it('extracts article body and normalizes lazy media', () => {
		const html = `
			<!doctype html>
			<html>
				<body>
					<article>
						<div class="entry-content">
							<p>Intro</p>
							<div class="rll-youtube-player" data-src="https://www.youtube.com/embed/abc123" data-alt="clip"></div>
							<img data-lazy-src="https://cdn.example.com/image.jpg" alt="lazy" />
							<script>alert('xss')</script>
						</div>
					</article>
				</body>
			</html>
		`;

		const result = extractArticleContentFromPage(html);

		expect(result).toContain('<p>Intro</p>');
		expect(result).toContain('iframe');
		expect(result).toContain('src="https://www.youtube.com/embed/abc123"');
		expect(result).toContain('src="https://cdn.example.com/image.jpg"');
		expect(result).not.toContain('<script>');
	});

	it('removes social widgets, noscript duplicates, and comments chrome', () => {
		const html = `
			<!doctype html>
			<html>
				<body>
					<article>
						<div class="entry-content">
							<p>Lead paragraph</p>
							<div class="rll-youtube-player" data-src="https://www.youtube.com/embed/abc123"></div>
							<noscript><iframe src="https://www.youtube.com/embed/abc123"></iframe></noscript>
							<div class="post-media-buttons">
								<a href="https://twitter.com/share">Tweet</a>
							</div>
							<div id="comments">Comments</div>
						</div>
					</article>
				</body>
			</html>
		`;

		const result = extractArticleContentFromPage(html);

		expect(result).toContain('Lead paragraph');
		expect(result).toContain('https://www.youtube.com/embed/abc123');
		expect(result).not.toContain('<noscript>');
		expect(result).not.toContain('Tweet');
		expect(result).not.toContain('Comments');
	});

	it('extracts VideoPress embeds hidden behind click-to-load widgets', () => {
		const html = `
			<!doctype html>
			<html>
				<body>
					<article>
						<div class="entry-content">
							<div class="eosb_video_widget">
								<div class="eosb_wrapper">
									<div class="eosb_video_wrapper">
										<img src="https://example.com/wp-content/plugins/load-video-on-click/assets/img/ajax-loader.gif" />
										<div id="eos-video-test-iframe"></div>
										<script>
											const i = document.createElement('iframe');
											i.src = 'https://videopress.com/v/bskzi1r2?autoplay=1&loop=1&muted=1';
										</script>
									</div>
								</div>
							</div>
						</div>
					</article>
				</body>
			</html>
		`;

		const result = extractArticleContentFromPage(html);
		const media = extractMediaFromHtml(result);

		expect(result).toContain('https://videopress.com/embed/bskzi1r2');
		expect(result).not.toContain('ajax-loader.gif');
		expect(media).toHaveLength(1);
		expect(media[0]!.provider).toBe('videopress');
		expect(media[0]!.embedUrl).toBe('https://videopress.com/embed/bskzi1r2');
	});
});
