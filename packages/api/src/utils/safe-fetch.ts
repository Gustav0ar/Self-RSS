import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
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

export async function assertSafeRemoteUrl(
	rawUrl: string,
	options: RemoteFetchSecurityOptions,
	lookupFn: LookupFn = (hostname, options) =>
		lookup(hostname, options) as Promise<LookupAddressRecord[]>,
) {
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

	if (!options.allowPrivateHosts) {
		if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
			throw AppError.badRequest('Feed URL must not target a local or private network host');
		}

		if (isPrivateIpAddress(hostname)) {
			throw AppError.badRequest('Feed URL must not target a local or private network host');
		}

		const addresses = await lookupFn(hostname, { all: true, verbatim: true });
		if (addresses.some((entry: LookupAddressRecord) => isPrivateIpAddress(entry.address))) {
			throw AppError.badRequest('Feed URL must not target a local or private network host');
		}
	}

	return url.toString();
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
	let currentUrl = await assertSafeRemoteUrl(input, options, lookupFn);

	for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
		const response = await fetchImpl(currentUrl, {
			...init,
			redirect: 'manual',
		});

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

		currentUrl = await assertSafeRemoteUrl(
			new URL(location, currentUrl).toString(),
			options,
			lookupFn,
		);
	}

	throw AppError.badRequest('Feed URL exceeded the maximum number of redirects');
}
