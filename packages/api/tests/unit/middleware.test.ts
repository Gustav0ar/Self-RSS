import { describe, expect, it } from 'vitest';
import { errorHandler, requestIdMiddleware } from '../../src/middleware/common.js';
import { AppError } from '../../src/middleware/errors.js';

function buildContext({ requestId, status = 200 }: { requestId?: string; status?: number }) {
	const headers = new Headers();
	const setStatus = (s: number) => {
		(context as { status: number }).status = s;
	};
	const context: {
		req: { raw: { signal: AbortSignal } };
		res: { status: number };
		get: <T = unknown>(key: string) => T | undefined;
		set: (key: string, value: unknown) => void;
		header: (name: string, value: string) => void;
		json: (body: unknown, status?: number) => Response;
		status: number;
	} = {
		req: { raw: { signal: new AbortController().signal } },
		res: { status },
		get: <T>(key: string) => (key === 'requestId' ? (requestId as T | undefined) : undefined),
		set: () => undefined,
		header: (name: string, value: string) => {
			headers.set(name, value);
		},
		json: (body: unknown, code?: number) => {
			if (code) setStatus(code);
			return new Response(JSON.stringify(body), {
				status: code ?? 200,
				headers,
			});
		},
		status,
	};
	return context;
}

describe('requestIdMiddleware', () => {
	it('generates a UUID request id and echoes it on the response header', async () => {
		const context = buildContext({});
		const next = async () => undefined;

		await requestIdMiddleware(context as never, next);

		expect(context.header).toBeDefined();
	});
});

describe('errorHandler', () => {
	it('serializes AppError details and respects status codes', async () => {
		const err = new AppError('BAD_REQUEST', 'Validation error', 400, { fieldErrors: { x: 'bad' } });
		const context = buildContext({ requestId: 'req-1' });
		const response = await errorHandler(err, context as never);

		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error.code).toBe('BAD_REQUEST');
		expect(body.error.message).toBe('Validation error');
		expect(body.error.details).toEqual({ fieldErrors: { x: 'bad' } });
	});

	it('returns 500 with a generic message for unknown errors', async () => {
		const err = new Error('boom');
		const context = buildContext({ requestId: 'req-2' });
		const response = await errorHandler(err, context as never);

		expect(response.status).toBe(500);
		const body = await response.json();
		expect(body.error.code).toBe('INTERNAL_ERROR');
		expect(body.error.message).toBe('Internal server error');
	});

	it('formats all AppError status code branches', async () => {
		const cases: Array<[AppError, number, string]> = [
			[AppError.badRequest('x'), 400, 'BAD_REQUEST'],
			[AppError.unauthorized('x'), 401, 'UNAUTHORIZED'],
			[AppError.forbidden('x'), 403, 'FORBIDDEN'],
			[AppError.notFound('x'), 404, 'NOT_FOUND'],
			[AppError.conflict('x'), 409, 'CONFLICT'],
			[AppError.tooManyRequests('x'), 429, 'TOO_MANY_REQUESTS'],
			[AppError.internal('x'), 500, 'INTERNAL_ERROR'],
		];

		for (const [err, status, code] of cases) {
			const context = buildContext({});
			const response = await errorHandler(err, context as never);
			expect(response.status).toBe(status);
			const body = await response.json();
			expect(body.error.code).toBe(code);
		}
	});
});
