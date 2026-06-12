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
		useSearchMock.mockReturnValue({ data: { data: [] }, isLoading: false });
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it('debounces the search query before passing it to useSearch', () => {
		render(<SearchBar onSelectArticle={() => {}} />);

		const input = screen.getByPlaceholderText('Search articles...');
		fireEvent.change(input, { target: { value: 'Alpha' } });

		expect(useSearchMock).toHaveBeenLastCalledWith('');

		act(() => {
			vi.advanceTimersByTime(299);
		});
		expect(useSearchMock).toHaveBeenLastCalledWith('');

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(useSearchMock).toHaveBeenLastCalledWith('Alpha');
	});

	it('selects the highlighted result when the user presses Enter', () => {
		const onSelect = vi.fn();
		useSearchMock.mockReturnValue({
			data: {
				data: [
					{ id: 'a-1', title: 'Alpha', feedTitle: 'Feed A', excerpt: null, heroImageUrl: null },
					{ id: 'a-2', title: 'Beta', feedTitle: 'Feed A', excerpt: null, heroImageUrl: null },
				],
			},
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
});
