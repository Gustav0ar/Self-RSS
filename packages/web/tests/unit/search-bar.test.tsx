import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchBar } from '../../src/components/search/search-bar';

const useSearchMock = vi.fn();

vi.mock('../../src/hooks/queries', () => ({
	useSearch: (...args: unknown[]) => useSearchMock(...args),
}));

describe('SearchBar', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		useSearchMock.mockReturnValue({
			data: { pages: [{ data: [], cursor: null, hasMore: false }] },
			fetchNextPage: vi.fn(),
			hasNextPage: false,
			isFetchingNextPage: false,
			isLoading: false,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it('debounces the search query before passing it to useSearch', () => {
		render(<SearchBar onSelectArticle={() => {}} />);

		const input = screen.getByPlaceholderText('Search articles...');
		fireEvent.change(input, { target: { value: 'Alpha' } });

		expect(useSearchMock).toHaveBeenLastCalledWith('', undefined);

		act(() => {
			vi.advanceTimersByTime(299);
		});
		expect(useSearchMock).toHaveBeenLastCalledWith('', undefined);

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(useSearchMock).toHaveBeenLastCalledWith('Alpha', undefined);
	});

	it('selects the highlighted result when the user presses Enter', () => {
		const onSelect = vi.fn();
		useSearchMock.mockReturnValue({
			data: {
				pages: [
					{
						data: [
							{
								id: 'a-1',
								title: 'Alpha',
								feedTitle: 'Feed A',
								excerpt: null,
								heroImageUrl: null,
							},
							{
								id: 'a-2',
								title: 'Beta',
								feedTitle: 'Feed A',
								excerpt: null,
								heroImageUrl: null,
							},
						],
						cursor: null,
						hasMore: false,
					},
				],
			},
			fetchNextPage: vi.fn(),
			hasNextPage: false,
			isFetchingNextPage: false,
			isLoading: false,
		});

		render(<SearchBar onSelectArticle={onSelect} />);
		const input = screen.getByPlaceholderText('Search articles...');
		fireEvent.change(input, { target: { value: 'Al' } });

		act(() => {
			vi.advanceTimersByTime(300);
		});

		fireEvent.keyDown(input, { key: 'ArrowDown' });
		fireEvent.keyDown(input, { key: 'Enter' });

		expect(onSelect).toHaveBeenCalledWith('a-1');
	});

	it('passes the active category id when current scope is selected', () => {
		render(<SearchBar onSelectArticle={() => {}} categoryId="category-1" />);
		const input = screen.getByPlaceholderText('Search articles...');
		fireEvent.change(input, { target: { value: 'Alpha' } });
		act(() => {
			vi.advanceTimersByTime(300);
		});

		fireEvent.click(screen.getByRole('button', { name: 'Current' }));

		expect(useSearchMock).toHaveBeenLastCalledWith('Alpha', 'category-1');
	});

	it('wires combobox controls, active descendant, options, and scope pressed state', () => {
		useSearchMock.mockReturnValue({
			data: {
				pages: [
					{
						data: [
							{
								id: 'a-1',
								title: 'Alpha',
								feedTitle: 'Feed A',
								excerpt: null,
								heroImageUrl: null,
							},
						],
						cursor: null,
						hasMore: false,
					},
				],
			},
			fetchNextPage: vi.fn(),
			hasNextPage: false,
			isFetchingNextPage: false,
			isLoading: false,
		});

		render(<SearchBar onSelectArticle={() => {}} categoryId="category-1" />);
		const input = screen.getByRole('combobox', { name: 'Search articles' });
		fireEvent.change(input, { target: { value: 'Al' } });
		act(() => {
			vi.advanceTimersByTime(300);
		});

		const listbox = screen.getByRole('listbox', { name: 'Search results' });
		const option = screen.getByRole('option', { name: /Alpha/ });
		expect(input.getAttribute('aria-controls')).toBe(listbox.id);
		expect(option.getAttribute('aria-selected')).toBe('false');

		fireEvent.keyDown(input, { key: 'ArrowDown' });
		expect(input.getAttribute('aria-activedescendant')).toBe(option.id);
		expect(option.getAttribute('aria-selected')).toBe('true');
		expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
		expect(screen.getByRole('button', { name: 'Current' }).getAttribute('aria-pressed')).toBe(
			'false',
		);
	});
});
