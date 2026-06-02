import type {} from 'hono';

declare module 'hono' {
	interface ContextVariableMap {
		requestId: string;
		userId: string;
		userRole: string;
	}
}
