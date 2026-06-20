import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
	TopBar: (props: { onOpenSidebar?: () => void; onSelectArticle?: (id: string) => void }) => {
		topBarPropsSpy(props);
		return (
			<div>
				<button type="button" onClick={props.onOpenSidebar}>
					Open menu
				</button>
				<button type="button" onClick={() => props.onSelectArticle?.('article-9')}>
					Open article
				</button>
			</div>
		);
	},
}));

vi.mock('../../src/hooks/queries', () => ({
	usePreferences: () => ({
		data: {
			fontFamily: 'Inter',
			textSize: 16,
			density: 'comfortable',
		},
	}),
}));

vi.mock('../../src/providers/theme', () => ({
	useTheme: () => ({
		theme: 'system',
		resolvedTheme: 'light',
		setTheme: vi.fn(),
	}),
}));

vi.mock('../../src/hooks/use-read-state-sync', () => ({
	useReadStateSync: vi.fn(),
}));

describe('RootLayout routing', () => {
	afterEach(() => {
		document.body.style.overflow = '';
	});

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

	it('restores body overflow when the mobile sidebar drawer closes', () => {
		document.body.style.overflow = 'clip';

		render(<RootLayout />);

		fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
		expect(document.body.style.overflow).toBe('hidden');

		fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
		expect(document.body.style.overflow).toBe('clip');
	});
});
