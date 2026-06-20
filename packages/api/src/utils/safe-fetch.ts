import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { AppError } from '../middleware/errors.js';

interface RemoteFetchSecurityOptions {
	allowPrivateHosts: boolean;
	maxRedirects?: number;
}

type LookupAddressRecord = { address: string; family: number };
type LookupFn = (
	hostname: string,
	options: { all: true; verbatim: true },
) => Promise<LookupAddressRecord[]>;
type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

interface FetchWithValidatedRedirectsDeps {
	lookupFn?: LookupFn;
	fetchImpl?: FetchImpl;
}

interface ValidatedRemoteUrl {
	url: string;
	addresses: LookupAddressRecord[];
}

type PinnedRequestBody = string | Uint8Array | ReadableStream;

function isRedirectStatus(status: number) {
	return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isPrivateIpv4(ip: string) {
	const parts = ip.split('.').map((part) => Number.parseInt(part, 10));
	if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
		return false;
	}

	const a = parts[0];
	const b = parts[1];
	if (a === undefined || b === undefined) {
		return false;
	}
	if (a === 0 || a === 10 || a === 127) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 100 && b >= 64 && b <= 127) return true;
	if (a === 198 && (b === 18 || b === 19)) return true;
	if (a >= 224) return true;
	return false;
}

function expandIpv6(ip: string) {
	const [head, tail = ''] = ip.toLowerCase().split('::');
	const headParts = head ? head.split(':').filter(Boolean) : [];
	const tailParts = tail ? tail.split(':').filter(Boolean) : [];
	const missingGroups = 8 - (headParts.length + tailParts.length);
	if (!ip.includes('::')) {
		return headParts;
	}
	return [...headParts, ...Array.from({ length: missingGroups }, () => '0'), ...tailParts];
}

function parseIpv4MappedIpv6(ip: string) {
	const normalized = ip.toLowerCase();
	if (!normalized.includes('.')) {
		return null;
	}
	const lastColon = normalized.lastIndexOf(':');
	if (lastColon === -1) {
		return null;
	}
	return normalized.slice(lastColon + 1);
}

function isPrivateIpv6(ip: string) {
	const normalized = ip.toLowerCase();
	if (normalized === '::' || normalized === '::1') return true;

	const mappedIpv4 = parseIpv4MappedIpv6(normalized);
	if (mappedIpv4) {
		return isPrivateIpv4(mappedIpv4);
	}

	const parts = expandIpv6(normalized);
	const first = Number.parseInt(parts[0] ?? '0', 16);
	if (Number.isNaN(first)) {
		return false;
	}

	if ((first & 0xfe00) === 0xfc00) return true;
	if ((first & 0xffc0) === 0xfe80) return true;
	if ((first & 0xff00) === 0xff00) return true;
	return false;
}

function isPrivateIpAddress(ip: string) {
	const version = isIP(ip);
	if (version === 4) return isPrivateIpv4(ip);
	if (version === 6) return isPrivateIpv6(ip);
	return false;
}

async function validateRemoteUrl(
	rawUrl: string,
	options: RemoteFetchSecurityOptions,
	lookupFn: LookupFn = (hostname, options) =>
		lookup(hostname, options) as Promise<LookupAddressRecord[]>,
): Promise<ValidatedRemoteUrl> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw AppError.badRequest('Invalid remote URL');
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw AppError.badRequest('Only HTTP and HTTPS feed URLs are allowed');
	}

	if (url.username || url.password) {
		throw AppError.badRequest('Feed URLs must not include credentials');
	}

	const hostname = url.hostname.toLowerCase();
	if (!hostname) {
		throw AppError.badRequest('Remote URL must include a hostname');
	}

	const ipVersion = isIP(hostname);
	const addresses: LookupAddressRecord[] =
		ipVersion === 4 || ipVersion === 6
			? [{ address: hostname, family: ipVersion }]
			: await lookupFn(hostname, { all: true, verbatim: true });

	if (!options.allowPrivateHosts) {
		if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
			throw AppError.badRequest('Feed URL must not target a local or private network host');
		}

		if (isPrivateIpAddress(hostname)) {
			throw AppError.badRequest('Feed URL must not target a local or private network host');
		}

		if (addresses.some((entry: LookupAddressRecord) => isPrivateIpAddress(entry.address))) {
			throw AppError.badRequest('Feed URL must not target a local or private network host');
		}
	}

	if (addresses.length === 0) {
		throw AppError.badRequest('Remote URL hostname did not resolve');
	}

	return { url: url.toString(), addresses };
}

export async function assertSafeRemoteUrl(
	rawUrl: string,
	options: RemoteFetchSecurityOptions,
	lookupFn: LookupFn = (hostname, options) =>
		lookup(hostname, options) as Promise<LookupAddressRecord[]>,
) {
	return (await validateRemoteUrl(rawUrl, options, lookupFn)).url;
}

function headersFromIncoming(headers: Record<string, string | string[] | undefined>) {
	const responseHeaders = new Headers();
	for (const [name, value] of Object.entries(headers)) {
		if (Array.isArray(value)) {
			for (const item of value) {
				responseHeaders.append(name, item);
			}
		} else if (value !== undefined) {
			responseHeaders.set(name, value);
		}
	}
	return responseHeaders;
}

function bodyFromRequestInit(init: RequestInit): PinnedRequestBody | undefined {
	const body = init.body;
	if (!body) return undefined;
	if (typeof body === 'string' || body instanceof ReadableStream) {
		return body;
	}
	if (body instanceof URLSearchParams) {
		return body.toString();
	}
	if (body instanceof ArrayBuffer) {
		return new Uint8Array(body);
	}
	if (ArrayBuffer.isView(body)) {
		return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
	}
	throw AppError.badRequest('Unsupported remote fetch request body');
}

async function fetchWithPinnedLookup(validated: ValidatedRemoteUrl, init: RequestInit) {
	const url = new URL(validated.url);
	const address = validated.addresses[0];
	if (!address) {
		throw AppError.badRequest('Remote URL hostname did not resolve');
	}

	const requestImpl = url.protocol === 'https:' ? httpsRequest : httpRequest;
	const headers = Object.fromEntries(new Headers(init.headers).entries());
	if (!headers.host) {
		headers.host = url.host;
	}
	const method = init.method ?? 'GET';
	const body = bodyFromRequestInit(init);

	return new Promise<Response>((resolve, reject) => {
		const req = requestImpl(
			{
				protocol: url.protocol,
				hostname: address.address,
				port: url.port || undefined,
				path: `${url.pathname}${url.search}`,
				method,
				headers,
				servername: url.protocol === 'https:' ? url.hostname : undefined,
				signal: init.signal ?? undefined,
			},
			(res) => {
				const responseHeaders = headersFromIncoming(res.headers);
				const responseBody = Readable.toWeb(res) as unknown as ReadableStream;
				resolve(
					new Response(responseBody, {
						status: res.statusCode ?? 200,
						statusText: res.statusMessage,
						headers: responseHeaders,
					}),
				);
			},
		);

		req.on('error', reject);
		if (body instanceof ReadableStream) {
			Readable.fromWeb(body as unknown as NodeReadableStream).pipe(req);
			return;
		}
		if (body !== undefined) {
			req.end(body);
			return;
		}
		req.end();
	});
}

export async function fetchWithValidatedRedirects(
	input: string,
	init: RequestInit,
	options: RemoteFetchSecurityOptions,
	deps: FetchWithValidatedRedirectsDeps = {},
) {
	const lookupFn = deps.lookupFn ?? lookup;
	const fetchImpl = deps.fetchImpl ?? fetch;
	const maxRedirects = options.maxRedirects ?? 3;
	let current = await validateRemoteUrl(input, options, lookupFn);

	// Per-redirect timeout. The caller's `init.signal` only cancels the
	// initial request; subsequent redirects inherit no signal and a
	// slow remote can stall the worker indefinitely. Compose both
	// signals so the caller's deadline still applies on every hop.
	const callerSignal = init.signal;
	const perRedirectTimeoutMs = 10_000;

	for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
		const perRedirectController = new AbortController();
		const perRedirectTimer = setTimeout(
			() => perRedirectController.abort(new Error('Redirect timeout')),
			perRedirectTimeoutMs,
		);
		const onCallerAbort = () => perRedirectController.abort(callerSignal?.reason);
		if (callerSignal) {
			if (callerSignal.aborted) {
				perRedirectController.abort(callerSignal.reason);
			} else {
				callerSignal.addEventListener('abort', onCallerAbort, { once: true });
			}
		}

		let response: Response;
		try {
			const requestInit = {
				...init,
				redirect: 'manual',
				signal: perRedirectController.signal,
			} satisfies RequestInit;
			response =
				deps.fetchImpl || options.allowPrivateHosts
					? await fetchImpl(current.url, requestInit)
					: await fetchWithPinnedLookup(current, requestInit);
		} finally {
			clearTimeout(perRedirectTimer);
			if (callerSignal) {
				callerSignal.removeEventListener('abort', onCallerAbort);
			}
		}

		if (!isRedirectStatus(response.status)) {
			return response;
		}

		if (redirectCount === maxRedirects) {
			throw AppError.badRequest('Feed URL exceeded the maximum number of redirects');
		}

		const location = response.headers.get('location');
		if (!location) {
			throw AppError.badRequest('Feed URL returned a redirect without a location');
		}

		current = await validateRemoteUrl(new URL(location, current.url).toString(), options, lookupFn);
	}

	throw AppError.badRequest('Feed URL exceeded the maximum number of redirects');
}
