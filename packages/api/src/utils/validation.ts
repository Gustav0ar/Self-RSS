import type { Context } from 'hono';
import { type ZodSchema, z } from 'zod';
import { AppError } from '../middleware/errors.js';

export async function parseBody<T>(c: Context, schema: ZodSchema<T>): Promise<T> {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		throw AppError.badRequest('Invalid JSON body');
	}
	const result = schema.safeParse(body);
	if (!result.success) {
		throw AppError.badRequest('Validation error', result.error.flatten());
	}
	return result.data;
}

export function parseQuery<T>(c: Context, schema: ZodSchema<T>): T {
	const raw = Object.fromEntries(new URL(c.req.url).searchParams);
	const result = schema.safeParse(raw);
	if (!result.success) {
		throw AppError.badRequest('Validation error', result.error.flatten());
	}
	return result.data;
}

const uuidParamSchema = z.string().uuid();

export function parseUuidParam(c: Context, key: string): string {
	const result = uuidParamSchema.safeParse(c.req.param(key));
	if (!result.success) {
		throw AppError.badRequest('Validation error', result.error.flatten());
	}
	return result.data;
}
