import { Component, ReactNode, isValidElement, type ErrorInfo } from 'react';

interface ErrorBoundaryProps {
	children: ReactNode;
	fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
	onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
}

/**
 * ErrorBoundary component that catches JavaScript errors in child components
 * and displays a fallback UI instead of crashing the entire application.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { hasError: true, error };
	}

	override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		// Log the error for debugging
		console.error('[ErrorBoundary] Caught error:', error, errorInfo);

		// Call the optional onError callback
		this.props.onError?.(error, errorInfo);
	}

	private handleReset = (): void => {
		this.setState({ hasError: false, error: null });
	};

	override render(): ReactNode {
		const { hasError, error } = this.state;
		const { children, fallback } = this.props;

		if (hasError && error) {
			// If a fallback is provided, use it
			if (fallback) {
				if (typeof fallback === 'function') {
					return fallback(error, this.handleReset);
				}
				if (isValidElement(fallback)) {
					return fallback;
				}
			}

			// Default fallback UI
			return (
				<DefaultErrorFallback error={error} onReset={this.handleReset} />
			);
		}

		return children;
	}
}

/**
 * Default error fallback UI with dismiss functionality
 */
function DefaultErrorFallback({
	error,
	onReset,
}: {
	error: Error;
	onReset: () => void;
}): ReactNode {
	return (
		<div
			style={{
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				minHeight: '200px',
				padding: '2rem',
				textAlign: 'center',
				backgroundColor: 'hsl(var(--destructive) / 0.1)',
				border: '1px solid hsl(var(--destructive) / 0.3)',
				borderRadius: 'var(--radius)',
				margin: '1rem',
			}}
			role="alert"
		>
			<div
				style={{
					fontSize: '2rem',
					marginBottom: '1rem',
					color: 'hsl(var(--destructive))',
				}}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="48"
					height="48"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					style={{ margin: '0 auto' }}
				>
					<circle cx="12" cy="12" r="10" />
					<line x1="12" y1="8" x2="12" y2="12" />
					<line x1="12" y1="16" x2="12.01" y2="16" />
				</svg>
			</div>

			<h2
				style={{
					fontSize: '1.25rem',
					fontWeight: 600,
					marginBottom: '0.5rem',
					color: 'hsl(var(--foreground))',
				}}
			>
				Something went wrong
			</h2>

			<p
				style={{
					color: 'hsl(var(--muted-foreground))',
					marginBottom: '1rem',
					maxWidth: '400px',
				}}
			>
				{error.message || 'An unexpected error occurred'}
			</p>

			{process.env.NODE_ENV === 'development' && error.stack && (
				<details
					style={{
						width: '100%',
						maxWidth: '600px',
						marginBottom: '1rem',
						textAlign: 'left',
					}}
				>
					<summary
						style={{
							cursor: 'pointer',
							fontWeight: 500,
							marginBottom: '0.5rem',
						}}
					>
						Stack Trace
					</summary>
					<pre
						style={{
							fontSize: '0.75rem',
							backgroundColor: 'hsl(var(--muted))',
							padding: '1rem',
							borderRadius: 'var(--radius)',
							overflow: 'auto',
							maxHeight: '200px',
							whiteSpace: 'pre-wrap',
							wordBreak: 'break-word',
						}}
					>
						{error.stack}
					</pre>
				</details>
			)}

			<button
				onClick={onReset}
				style={{
					padding: '0.5rem 1.5rem',
					backgroundColor: 'hsl(var(--primary))',
					color: 'hsl(var(--primary-foreground))',
					border: 'none',
					borderRadius: 'var(--radius)',
					fontSize: '0.875rem',
					fontWeight: 500,
					cursor: 'pointer',
					transition: 'opacity 0.2s',
				}}
				onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
				onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
			>
				Try Again
			</button>
		</div>
	);
}
