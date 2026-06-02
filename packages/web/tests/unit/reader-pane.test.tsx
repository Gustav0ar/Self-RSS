import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

vi.mock('../../src/hooks/queries', () => ({
	useArticle: () => ({
		data: articleWithEmbeddedHtml,
		isLoading: false,
	}),
	useMarkRead: () => ({ mutate: markReadMutate }),
	useEnrichArticle: () => ({ mutate: enrichMutate, isPending: false }),
}));

describe('ReaderPane', () => {
	it('keeps inline images in article content and renders only embedded media in the lower panel', () => {
		render(<ReaderPane articleId="article-1" />);

		const mediaPanel = document.querySelector('.surface-card.motion-enter.mt-6.space-y-4');
		expect(mediaPanel).toBeTruthy();
		expect(document.querySelectorAll('.reader-content img')).toHaveLength(1);
		expect(document.querySelectorAll('.reader-content iframe')).toHaveLength(0);
		expect(mediaPanel?.querySelectorAll('iframe')).toHaveLength(1);
		expect(mediaPanel?.querySelectorAll('img')).toHaveLength(0);
	});
});
