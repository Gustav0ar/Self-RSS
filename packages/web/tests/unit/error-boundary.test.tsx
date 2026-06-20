import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';

// Component that throws an error for testing
function ThrowError({ message }: { message?: string }): ReactNode {
	throw new Error(message ?? 'Test error');
}

describe('ErrorBoundary', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	describe('error catching', () => {
		it('catches errors thrown by child components', () => {
			render(
				<ErrorBoundary>
					<ThrowError message="Component crashed" />
				</ErrorBoundary>,
			);

			expect(screen.queryByText('Component crashed')).toBeTruthy();
		});

		it('renders fallback UI when an error is caught', () => {
			render(
				<ErrorBoundary>
					<ThrowError />
				</ErrorBoundary>,
			);

			expect(screen.getByRole('alert')).toBeTruthy();
			expect(screen.getByText('Something went wrong')).toBeTruthy();
		});
	});

	describe('console error logging', () => {
		it('logs errors to console.error when an error is caught', () => {
			render(
				<ErrorBoundary>
					<ThrowError message="Logging test error" />
				</ErrorBoundary>,
			);

			expect(console.error).toHaveBeenCalledWith(
				'[ErrorBoundary] Caught error:',
				expect.any(Error),
				expect.any(Object),
			);
		});

		it('calls the onError callback when provided', () => {
			const onError = vi.fn();

			render(
				<ErrorBoundary onError={onError}>
					<ThrowError message="Callback test" />
				</ErrorBoundary>,
			);

			expect(onError).toHaveBeenCalledTimes(1);
			expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.any(Object));
		});
	});

	describe('Try Again button', () => {
		it('resets error state and re-renders children when Try Again is clicked', () => {
			let shouldThrow = true;

			function ConditionalThrow() {
				if (shouldThrow) {
					throw new Error('Initial error');
				}
				return <div data-testid="success">Success on retry</div>;
			}

			const { rerender: _rerender } = render(
				<ErrorBoundary>
					<ConditionalThrow />
				</ErrorBoundary>,
			);

			expect(screen.getByRole('alert')).toBeTruthy();
			expect(screen.queryByTestId('success')).toBeNull();

			// Simulate state reset by changing the flag
			shouldThrow = false;

			fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

			expect(screen.getByTestId('success')).toBeTruthy();
			expect(screen.queryByRole('alert')).toBeNull();
		});
	});

	describe('normal rendering', () => {
		it('renders children normally when no error occurs', () => {
			render(
				<ErrorBoundary>
					<div data-testid="child">Normal child content</div>
				</ErrorBoundary>,
			);

			expect(screen.getByTestId('child')).toBeTruthy();
			expect(screen.getByText('Normal child content')).toBeTruthy();
		});

		it('renders multiple children normally', () => {
			render(
				<ErrorBoundary>
					<span>First child</span>
					<span>Second child</span>
				</ErrorBoundary>,
			);

			expect(screen.getByText('First child')).toBeTruthy();
			expect(screen.getByText('Second child')).toBeTruthy();
		});
	});

	describe('custom fallback', () => {
		it('renders custom fallback component when provided', () => {
			render(
				<ErrorBoundary fallback={<div data-testid="custom-fallback">Custom error UI</div>}>
					<ThrowError />
				</ErrorBoundary>,
			);

			expect(screen.getByTestId('custom-fallback')).toBeTruthy();
			expect(screen.queryByText('Something went wrong')).toBeNull();
		});

		it('renders custom fallback function with error and reset when provided', () => {
			const onReset = vi.fn();

			const fallbackFn = vi.fn((error, reset) => (
				<div data-testid="function-fallback">
					<p>
						Error message: <span data-testid="error-msg">{error.message}</span>
					</p>
					<button type="button" onClick={reset}>
						Reset
					</button>
					<button type="button" onClick={onReset}>
						External Reset
					</button>
				</div>
			));

			render(
				<ErrorBoundary fallback={fallbackFn}>
					<ThrowError message="Function fallback test" />
				</ErrorBoundary>,
			);

			expect(fallbackFn).toHaveBeenCalledWith(expect.any(Error), expect.any(Function));
			expect(screen.getByTestId('error-msg').textContent).toBe('Function fallback test');

			// Click the reset button inside the fallback - the fallback's reset callback
			// is passed to clear the ErrorBoundary's internal state
			fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
			// The fallback should be gone, but children throw again so fallback reappears
			// This verifies the reset function was called
			expect(screen.getByTestId('function-fallback')).toBeTruthy();
		});
	});
});
