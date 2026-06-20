export class AppError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly statusCode: number = 400,
		public readonly details?: unknown,
	) {
		super(message);
		this.name = 'AppError';
	}

	static badRequest(message: string, details?: unknown): AppError {
		return new AppError('BAD_REQUEST', message, 400, details);
	}

	static unauthorized(message = 'Unauthorized'): AppError {
		return new AppError('UNAUTHORIZED', message, 401);
	}

	static forbidden(message = 'Forbidden'): AppError {
		return new AppError('FORBIDDEN', message, 403);
	}

	static notFound(message = 'Not found'): AppError {
		return new AppError('NOT_FOUND', message, 404);
	}

	static conflict(message: string): AppError {
		return new AppError('CONFLICT', message, 409);
	}

	static tooManyRequests(message = 'Too many requests'): AppError {
		return new AppError('TOO_MANY_REQUESTS', message, 429);
	}

	static badGateway(message = 'Bad gateway', details?: unknown): AppError {
		return new AppError('BAD_GATEWAY', message, 502, details);
	}

	static internal(message = 'Internal server error'): AppError {
		return new AppError('INTERNAL_ERROR', message, 500);
	}
}
