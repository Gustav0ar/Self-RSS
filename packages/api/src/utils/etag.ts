import { createHash } from 'node:crypto';
import type { Context } from 'hono';

/** Serialize a JSON response with a weak ETag and return 304 when If-None-Match matches. */
export function jsonWithEtag<T>(c: Context, payload: T) {
	const body = JSON.stringify(payload);
	const etag = `W/"${createHash('sha1').update(body).digest('base64url')}"`;
	if (c.req.header('If-None-Match') === etag) {
		return c.body(null, 304, { ETag: etag, 'Cache-Control': 'private, no-cache' });
	}
	return c.body(body, 200, {
		'Content-Type': 'application/json; charset=UTF-8',
		ETag: etag,
		'Cache-Control': 'private, no-cache',
	});
}
