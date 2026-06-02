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
});
