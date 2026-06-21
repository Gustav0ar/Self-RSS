import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createExtractorRegistry,
	DefaultContentExtractor,
	NaointendidoContentExtractor,
} from '../../src/services/content-extractors/index.js';

describe('DefaultContentExtractor', () => {
	const extractor = new DefaultContentExtractor();

	describe('canHandle', () => {
		it('should return true for any URL', () => {
			expect(extractor.canHandle('https://example.com')).toBe(true);
			expect(extractor.canHandle('https://any-site.com/path')).toBe(true);
			expect(extractor.canHandle('http://localhost:3000')).toBe(true);
		});
	});

	describe('extract', () => {
		it('should return null for empty HTML', async () => {
			const result = await extractor.extract('', 'https://example.com');
			expect(result).toBeNull();
		});

		it('should return null for HTML without article content', async () => {
			const html = '<html><body><p>Just some text without article structure</p></body></html>';
			const result = await extractor.extract(html, 'https://example.com');
			expect(result).toBeNull();
		});

		it('should extract content from article with entry-content', async () => {
			const html = `
				<html>
				<body>
					<article>
						<div class="entry-content">
							<p>This is the article content with meaningful text.</p>
						</div>
					</article>
				</body>
				</html>
			`;
			const result = await extractor.extract(html, 'https://example.com');
			expect(result).not.toBeNull();
			expect(result?.content).toContain('article content');
		});

		it('should extract content from article with post-content', async () => {
			const html = `
				<html>
				<body>
					<article>
						<div class="post-content">
							<p>This is the blog post content here.</p>
						</div>
					</article>
				</body>
				</html>
			`;
			const result = await extractor.extract(html, 'https://example.com');
			expect(result).not.toBeNull();
			expect(result?.content).toContain('blog post content');
		});
	});
});

describe('NaointendidoContentExtractor', () => {
	// Create a mock that has both vitest mock methods and fetch methods
	// biome-ignore format: need intersection for mock + fetch
	const mockFetch = vi.fn() as typeof globalThis.fetch & ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockFetch.mockReset();
	});

	describe('canHandle', () => {
		const extractor = new NaointendidoContentExtractor();

		it('should return true for naointenido.com.br posts URL', () => {
			expect(extractor.canHandle('https://www.naointendido.com.br/posts/some-slug')).toBe(true);
		});

		it('should return true for naointenido.com.br posts URL with path', () => {
			expect(extractor.canHandle('https://naointendido.com.br/posts/my-post-123')).toBe(true);
		});

		it('should return false for other URLs', () => {
			expect(extractor.canHandle('https://example.com')).toBe(false);
			expect(extractor.canHandle('https://example.com/posts/some-slug')).toBe(false);
			expect(extractor.canHandle('https://evil-naointendido.com.br/posts/some-slug')).toBe(false);
			expect(extractor.canHandle('https://naointendido.com.br/')).toBe(false);
			expect(extractor.canHandle('https://naointendido.com.br/about')).toBe(false);
		});
	});

	describe('extract', () => {
		it('should return null for non-post URLs', async () => {
			const extractor = new NaointendidoContentExtractor({ fetch: mockFetch });
			const result = await extractor.extract('<html></html>', 'https://example.com');
			expect(result).toBeNull();
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('should not fetch API content for unrelated post URLs', async () => {
			const extractor = new NaointendidoContentExtractor({ fetch: mockFetch });
			const result = await extractor.extract(
				'<html></html>',
				'https://example.com/posts/test-slug',
			);
			expect(result).toBeNull();
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('should extract content from API response with image media', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					post: {
						media: {
							type: 'image',
							content: 'https://example.com/image.jpg',
						},
						description: '<p>Post description text</p>',
					},
				}),
			});

			const extractor = new NaointendidoContentExtractor({ fetch: mockFetch });
			const result = await extractor.extract(
				'<html></html>',
				'https://www.naointendido.com.br/posts/test-slug',
			);

			expect(result).not.toBeNull();
			expect(result?.content).toContain('<img src="https://example.com/image.jpg" />');
			expect(result?.content).toContain('Post description text');
		});

		it('should extract content with twitter media type', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					post: {
						media: {
							type: 'twitter',
							content: '1234567890',
						},
						description: '',
					},
				}),
			});

			const extractor = new NaointendidoContentExtractor({ fetch: mockFetch });
			const result = await extractor.extract(
				'<html></html>',
				'https://www.naointendido.com.br/posts/test-slug',
			);

			expect(result).not.toBeNull();
			expect(result?.content).toContain('platform.twitter.com/embed/Tweet.html?id=1234567890');
		});

		it('should extract content with video media type', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					post: {
						media: {
							type: 'video',
							content: 'https://example.com/video.mp4',
						},
						description: '<p>Video description</p>',
					},
				}),
			});

			const extractor = new NaointendidoContentExtractor({ fetch: mockFetch });
			const result = await extractor.extract(
				'<html></html>',
				'https://www.naointendido.com.br/posts/video-post',
			);

			expect(result).not.toBeNull();
			expect(result?.content).toContain('<video src="https://example.com/video.mp4" controls>');
		});

		it('should extract content with html media type', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					post: {
						media: {
							type: 'html',
							content: '<blockquote>Custom HTML block</blockquote>',
						},
						description: '',
					},
				}),
			});

			const extractor = new NaointendidoContentExtractor({ fetch: mockFetch });
			const result = await extractor.extract(
				'<html></html>',
				'https://www.naointendido.com.br/posts/html-post',
			);

			expect(result).not.toBeNull();
			expect(result?.content).toContain('<blockquote>Custom HTML block</blockquote>');
		});

		it('should sanitize HTML content and escape generated media attributes', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					post: {
						media: {
							type: 'image',
							content: 'https://example.com/image.jpg" onerror="alert(1)',
						},
						description: '<p onclick="alert(1)">Safe description</p><script>alert(1)</script>',
					},
				}),
			});

			const extractor = new NaointendidoContentExtractor({ fetch: mockFetch });
			const result = await extractor.extract(
				'<html></html>',
				'https://www.naointendido.com.br/posts/unsafe-post',
			);

			expect(result).not.toBeNull();
			expect(result?.content).toContain(
				'<img src="https://example.com/image.jpg&quot; onerror=&quot;alert(1)" />',
			);
			expect(result?.content).toContain('<p>Safe description</p>');
			expect(result?.content).not.toContain('onclick');
			expect(result?.content).not.toContain('<script');
			expect(result?.content).not.toContain('onerror="');
		});

		it('should return null when API returns non-ok response', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 404,
			});

			const extractor = new NaointendidoContentExtractor({ fetch: mockFetch });
			const result = await extractor.extract(
				'<html></html>',
				'https://www.naointendido.com.br/posts/missing-post',
			);

			expect(result).toBeNull();
		});

		it('should return null when API response has no post data', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({}),
			});

			const extractor = new NaointendidoContentExtractor({ fetch: mockFetch });
			const result = await extractor.extract(
				'<html></html>',
				'https://www.naointendido.com.br/posts/empty-post',
			);

			expect(result).toBeNull();
		});

		it('should return null when API fetch fails', async () => {
			mockFetch.mockRejectedValueOnce(new Error('Network error'));

			const extractor = new NaointendidoContentExtractor({ fetch: mockFetch });
			const result = await extractor.extract(
				'<html></html>',
				'https://www.naointendido.com.br/posts/error-post',
			);

			expect(result).toBeNull();
		});

		it('should handle post with only description and no media', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					post: {
						description: '<p>Just a text post without any media attachments.</p>',
					},
				}),
			});

			const extractor = new NaointendidoContentExtractor({ fetch: mockFetch });
			const result = await extractor.extract(
				'<html></html>',
				'https://www.naointendido.com.br/posts/text-only',
			);

			expect(result).not.toBeNull();
			expect(result?.content).toContain('text post without any media');
		});
	});
});

describe('createExtractorRegistry', () => {
	it('should create a registry with built-in extractors', () => {
		const registry = createExtractorRegistry();

		expect(typeof registry.register).toBe('function');
		expect(typeof registry.findExtractor).toBe('function');
		expect(typeof registry.extract).toBe('function');
	});

	it('should find the naointenido extractor for matching URLs', () => {
		const registry = createExtractorRegistry();
		const extractor = registry.findExtractor('https://www.naointendido.com.br/posts/test');

		expect(extractor).toBeDefined();
		expect(extractor?.canHandle('https://www.naointendido.com.br/posts/test')).toBe(true);
	});

	it('should find the default extractor for non-matching URLs', () => {
		const registry = createExtractorRegistry();
		const extractor = registry.findExtractor('https://example.com/article');

		expect(extractor).toBeDefined();
		expect(extractor?.canHandle('https://example.com')).toBe(true);
	});

	it('should allow registering custom extractors', () => {
		const registry = createExtractorRegistry();

		const customExtractor = {
			canHandle: (url: string) => url.includes('custom-site.com'),
			extract: async () => ({ content: 'Custom extracted content' }),
		};

		registry.register(customExtractor);

		const extractor = registry.findExtractor('https://custom-site.com/page');
		expect(extractor).toBe(customExtractor);
	});

	it('should prefer site-specific extractors over default', () => {
		const registry = createExtractorRegistry();
		const extractor = registry.findExtractor('https://www.naointendido.com.br/posts/my-post');

		// Should find the naointenido extractor, not the default
		expect(extractor).toBeInstanceOf(NaointendidoContentExtractor);
	});

	it('should use the correct extractor during extract', async () => {
		const originalFetch = globalThis.fetch;
		const mockFetch = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				post: {
					media: { type: 'image', content: 'https://example.com/img.png' },
					description: '<p>Naointendido post</p>',
				},
			}),
		});
		globalThis.fetch = mockFetch as unknown as typeof fetch;

		try {
			const registry = createExtractorRegistry();
			// The registry should use the built-in naointendido extractor
			const result = await registry.extract(
				'https://www.naointendido.com.br/posts/test',
				'<html></html>',
			);

			expect(result).not.toBeNull();
			expect(result?.content).toContain('Naointendido post');
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
