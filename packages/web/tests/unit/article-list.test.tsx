import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArticleList } from '../../src/components/articles/article-list';

vi.mock('@tanstack/react-virtual', () => ({
	useVirtualizer: (options: { count: number; estimateSize: () => number }) => ({
		getTotalSize: () => options.count * options.estimateSize(),
		getVirtualItems: () =>
			Array.from({ length: options.count }, (_, index) => ({
				index,
				key: index,
				start: index * options.estimateSize(),
			})),
		scrollToIndex: vi.fn(),
	}),
}));

describe('ArticleList', () => {
	it('renders each item with feed name, age, and title only', () => {
		const { container } = render(
			<ArticleList
				articles={[
					{
						id: 'article-1',
						feedId: 'feed-1',
						feedTitle: '9to5Google',
						feedFaviconUrl: null,
						title: 'Gemini Live can now access your past chats Memory, Connected Apps info',
						author: 'Abner Li',
						excerpt: 'Following the big Neural Expressive redesign and new voices last month.',
						heroImageUrl: 'https://example.com/poster.jpg',
						publishedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
						isRead: false,
					},
				]}
				selectedId="article-1"
				onSelect={() => {}}
			/>,
		);

		const row = screen.getByRole('button', {
			name: /Gemini Live can now access your past chats Memory, Connected Apps info/,
		});
		const rowText = row.textContent ?? '';

		expect(rowText).toContain('9to5Google');
		expect(rowText).toMatch(/ago/);
		expect(rowText).not.toContain('Abner Li');
		expect(rowText).not.toContain('Following the big Neural Expressive redesign');
		expect(container.querySelector('img[src="https://example.com/poster.jpg"]')).toBeNull();
		expect(row.classList.contains('overflow-hidden')).toBe(true);
		expect(row.style.height).toBe('82px');
	});

	it('renders an empty-state action when provided', () => {
		render(
			<ArticleList
				articles={[]}
				selectedId={null}
				onSelect={() => {}}
				emptyTitle="No unread articles"
				emptyDescription="Turn off the unread filter to review older stories."
				emptyAction={<button type="button">Show all articles</button>}
			/>,
		);

		expect(screen.getByText('No unread articles')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Show all articles' })).toBeTruthy();
	});
});
