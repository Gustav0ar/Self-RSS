/**
 * SSE Connection Registry
 *
 * Tracks active Server-Sent Events (SSE) connections for graceful shutdown.
 * During shutdown, the server waits for all tracked connections to drain
 * before closing, ensuring clients receive their final events.
 *
 * Usage:
 *   - Call `register(connectionId)` when an SSE stream starts
 *   - Call `unregister(connectionId)` when the stream closes
 *   - Call `drain(timeoutMs)` during shutdown to wait for all connections to close
 */

export interface SseConnection {
	id: string;
	startedAt: number;
	userId?: string;
}

const DEFAULT_DRAIN_TIMEOUT_MS = 30_000; // 30 seconds

/**
 * Registry for tracking active SSE connections.
 * Uses a Set internally for O(1) add/remove operations.
 */
export class SseConnectionRegistry {
	private connections = new Map<string, SseConnection>();
	private _isShuttingDown = false;

	/**
	 * Register a new SSE connection.
	 * Returns an unregister function to call when the connection closes.
	 */
	register(connection: SseConnection): () => void {
		this.connections.set(connection.id, connection);
		return () => this.unregister(connection.id);
	}

	/**
	 * Unregister an SSE connection by ID.
	 */
	unregister(id: string): void {
		this.connections.delete(id);
	}

	/**
	 * Get the count of active SSE connections.
	 */
	get count(): number {
		return this.connections.size;
	}

	/**
	 * Get all active connections for inspection.
	 */
	get connectionsSnapshot(): SseConnection[] {
		return Array.from(this.connections.values());
	}

	/**
	 * Mark the registry as shutting down.
	 * This prevents new long-running operations.
	 */
	setShuttingDown(): void {
		this._isShuttingDown = true;
	}

	/**
	 * Check if the registry is in shutdown mode.
	 */
	get isShuttingDown(): boolean {
		return this._isShuttingDown;
	}

	/**
	 * Drain all SSE connections within the specified timeout.
	 * Waits for all connections to unregister before resolving.
	 * Resolves immediately if no connections are active.
	 * Resolves with remaining connections if timeout is exceeded.
	 *
	 * @param timeoutMs - Maximum time to wait in milliseconds (default: 30s)
	 * @returns The number of connections that were still active after timeout
	 */
	async drain(timeoutMs = DEFAULT_DRAIN_TIMEOUT_MS): Promise<number> {
		const startTime = Date.now();
		const checkInterval = 100; // Check every 100ms

		while (this.connections.size > 0) {
			// Check if we've exceeded the timeout
			const elapsed = Date.now() - startTime;
			if (elapsed >= timeoutMs) {
				return this.connections.size;
			}

			// Wait before checking again
			await sleep(checkInterval);
		}

		return 0; // All connections drained successfully
	}

	/**
	 * Force close all connections by clearing the registry.
	 * Use this as a last resort when graceful drain times out.
	 */
	forceClose(): number {
		const count = this.connections.size;
		this.connections.clear();
		return count;
	}
}

/**
 * Singleton instance of the SSE connection registry.
 * Shared across all SSE routes in the API server.
 */
export const sseRegistry = new SseConnectionRegistry();

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
