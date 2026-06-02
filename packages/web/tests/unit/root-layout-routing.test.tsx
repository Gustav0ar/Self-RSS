import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RootLayout } from '../../src/components/layout/root-layout';

const navigateMock = vi.fn();
const sidebarPropsSpy = vi.fn();
const topBarPropsSpy = vi.fn();

vi.mock('@tanstack/react-router', () => ({
	Outlet: () => <div data-testid="outlet" />,
	useRouter: () => ({ navigate: navigateMock }),
}));

vi.mock('../../src/providers/auth', () => ({
	useAuth: () => ({
		isAuthenticated: true,
		isLoading: false,
	}),
}));

vi.mock('../../src/providers/app-state', () => ({
	useAppState: () => ({
		selectedFeedId: 'feed-1',
		selectedCategoryId: undefined,
	}),
}));

vi.mock('../../src/components/layout/sidebar', () => ({
	Sidebar: (props: {
		onSelectAll: () => void;
		onSelectFeed: (feedId: string) => void;
		onSelectCategory: (categoryId: string) => void;
	}) => {
		sidebarPropsSpy(props);
		return (
			<div>
				<button type="button" onClick={props.onSelectAll}>
					All feeds
				</button>
				<button type="button" onClick={() => props.onSelectFeed('feed-2')}>
					Feed 2
				</button>
				<button type="button" onClick={() => props.onSelectCategory('category-2')}>
					Category 2
				</button>
			</div>
		);
	},
}));

vi.mock('../../src/components/layout/top-bar', () => ({
	TopBar: (props: { onSelectArticle?: (id: string) => void }) => {
		topBarPropsSpy(props);
		return (
			<button type="button" onClick={() => props.onSelectArticle?.('article-9')}>
				Open article
			</button>
		);
	},
}));

describe('RootLayout routing', () => {
	it('navigates to article URLs while preserving the current feed context', () => {
		render(<RootLayout />);

		fireEvent.click(screen.getByRole('button', { name: 'Open article' }));

		expect(navigateMock).toHaveBeenCalledWith({
			to: '/articles/$articleId',
			params: { articleId: 'article-9' },
			search: { feedId: 'feed-1' },
		});
	});

	it('navigates sidebar selections through the router', () => {
		render(<RootLayout />);
		navigateMock.mockClear();

		fireEvent.click(screen.getByRole('button', { name: 'All feeds' }));
		fireEvent.click(screen.getByRole('button', { name: 'Feed 2' }));
		fireEvent.click(screen.getByRole('button', { name: 'Category 2' }));

		expect(navigateMock).toHaveBeenNthCalledWith(1, { to: '/' });
		expect(navigateMock).toHaveBeenNthCalledWith(2, {
			to: '/',
			search: { feedId: 'feed-2' },
		});
		expect(navigateMock).toHaveBeenNthCalledWith(3, {
			to: '/',
			search: { categoryId: 'category-2' },
		});
	});
});
