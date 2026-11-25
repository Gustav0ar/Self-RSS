import { type ClassValue, clsx } from 'clsx';
import { formatDistanceToNow } from 'date-fns';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/** Return a normalized http(s) URL string, or null for unsafe or malformed values. */
export function toSafeExternalUrl(rawUrl: string | null | undefined): string | null {
	if (!rawUrl) return null;
	try {
		const target = new URL(rawUrl.trim());
		if (target.protocol !== 'https:' && target.protocol !== 'http:') {
			return null;
		}
		return target.href;
	} catch {
		return null;
	}
}

/** Format an ISO timestamp as relative time, returning null for missing or invalid dates. */
export function formatRelativeTime(value: string | null | undefined): string | null {
	if (!value) return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return formatDistanceToNow(date, { addSuffix: true });
}
