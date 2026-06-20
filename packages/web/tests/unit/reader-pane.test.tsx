import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderPane } from '../../src/components/articles/reader-pane';

const articleWithEmbeddedHtml = {
	id: 'article-1',
	canonicalUrl: 'https://example.com/post-1',
	title: 'Post 1',
	author: 'Author',
	publishedAt: '2026-05-22T23:00:00.000Z',
	feedTitle: 'Feed',
	feedFaviconUrl: null,
	isRead: false,
	isEnriched: true,
	excerpt: 'Excerpt',
	contentHtml:
		'<p>Body</p><img src="https://example.com/image-1.jpg" alt="Inline image" /><iframe class="embedded-media embedded-media--videopress" width="560" height="996" src="https://videopress.com/embed/PDGidPsP"></iframe>',
	contentText: 'Body',
	media: [
		{
			id: 'media-image',
			articleId: 'article-1',
			type: 'image',
			provider: 'other',
			url: 'https://example.com/image-1.jpg',
			embedUrl: null,
			width: null,
			height: null,
			position: 0,
		},
		{
			id: 'media-embed',
			articleId: 'article-1',
			type: 'embed',
			provider: 'videopress',
			url: 'https://videopress.com/v/PDGidPsP?autoplay=1',
			embedUrl: 'https://videopress.com/embed/PDGidPsP',
			width: null,
			height: null,
			position: 1,
		},
	],
};

const markReadMutate = vi.fn();
const enrichMutate = vi.fn();
let autoMarkReadMode = 'on_navigate';
let currentArticle = articleWithEmbeddedHtml;

vi.mock('../../src/hooks/queries', () => ({
	useArticle: () => ({
		data: currentArticle,
		isLoading: false,
	}),
	useMarkRead: () => ({ mutate: markReadMutate }),
	useEnrichArticle: () => ({ mutate: enrichMutate, isPending: false }),
	usePreferences: () => ({ data: { autoMarkReadMode } }),
}));

describe('ReaderPane', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		autoMarkReadMode = 'on_navigate';
		currentArticle = articleWithEmbeddedHtml;
	});

	it('keeps inline images in article content and renders only embedded media in the lower panel', () => {
		render(<ReaderPane articleId="article-1" />);

		const mediaPanel = document.querySelector('.surface-card.motion-enter.mt-6.space-y-4');
		expect(mediaPanel).toBeTruthy();
		expect(document.querySelectorAll('.reader-content img')).toHaveLength(1);
		expect(document.querySelectorAll('.reader-content iframe')).toHaveLength(0);
		expect(mediaPanel?.querySelectorAll('iframe')).toHaveLength(1);
		expect(mediaPanel?.querySelectorAll('img')).toHaveLength(0);
	});

	it('does not mark articles read on open when auto-mark is on navigate', () => {
		render(<ReaderPane articleId="article-1" />);

		expect(markReadMutate).not.toHaveBeenCalled();
	});

	it('marks articles read on open when auto-mark is on open', async () => {
		autoMarkReadMode = 'on_open';

		render(<ReaderPane articleId="article-1" />);

		await waitFor(() => {
			expect(markReadMutate).toHaveBeenCalledWith(
				{ articleId: 'article-1', read: true },
				expect.any(Object),
			);
		});
	});

	it('requests enrichment for the selected article when media is not enriched yet', async () => {
		currentArticle = {
			...articleWithEmbeddedHtml,
			isEnriched: false,
			contentHtml: '<p>Text-only feed content</p>',
			media: [],
		};

		render(<ReaderPane articleId="article-1" />);

		await waitFor(() => {
			expect(enrichMutate).toHaveBeenCalledWith('article-1', expect.any(Object));
		});
	});

	it('updates scroll progress through a scheduled DOM write', () => {
		const animation = { callback: undefined as FrameRequestCallback | undefined };
		const requestAnimationFrame = vi
			.spyOn(window, 'requestAnimationFrame')
			.mockImplementation((callback) => {
				animation.callback = callback;
				return 1;
			});
		const cancelAnimationFrame = vi
			.spyOn(window, 'cancelAnimationFrame')
			.mockImplementation(() => {});

		const { unmount } = render(<ReaderPane articleId="article-1" />);
		const progress = document.querySelector<HTMLElement>('.reader-scroll-progress');
		expect(progress).toBeTruthy();
		const scroller = progress?.parentElement as HTMLElement;
		Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 });
		Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 500 });
		Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: 250 });

		fireEvent.scroll(scroller);
		expect(progress?.style.transform).toBe('scaleX(0)');

		if (!animation.callback) {
			throw new Error('Expected scroll progress to schedule an animation frame');
		}
		animation.callback(0);
		expect(progress?.style.transform).toBe('scaleX(0.5)');

		unmount();
		expect(cancelAnimationFrame).not.toHaveBeenCalled();
		requestAnimationFrame.mockRestore();
		cancelAnimationFrame.mockRestore();
	});
});
