import { readResponseTextWithinLimit } from '../utils/bounded-response.js';
import { createLogger } from '../utils/logger.js';
import { fetchWithValidatedRedirects } from '../utils/safe-fetch.js';
import { extractArticleContentFromPage } from '../utils/sanitizer.js';
import {
	buildNaointendidoApiUrl,
	parseNaointendidoPost,
	reconstructNaointendidoPostHtml,
} from './content-extractors/naointendido-post.js';

const logger = createLogger();

interface ArticleSourceFetchOptions {
	timeoutMs: number;
	maxContentLength: number;
	allowPrivateHosts: boolean;
}

export async function fetchArticlePageContent(
	canonicalUrl: string,
	options: ArticleSourceFetchOptions,
) {
	const timeoutMs = Math.min(options.timeoutMs, 5000);
	const withAttemptTimeout = async <T>(
		operation: (controller: AbortController) => Promise<T>,
	): Promise<T> => {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		try {
			return await operation(controller);
		} finally {
			clearTimeout(timeout);
		}
	};

	try {
		const naointendidoApiUrl = buildNaointendidoApiUrl(canonicalUrl);
		if (naointendidoApiUrl) {
			try {
				const providerHtml = await withAttemptTimeout(async (controller) => {
					const response = await fetchWithValidatedRedirects(
						naointendidoApiUrl,
						{
							signal: controller.signal,
							headers: {
								'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
								Accept: 'application/json',
								'X-Requested-With': 'XMLHttpRequest',
							},
						},
						{ allowPrivateHosts: options.allowPrivateHosts, maxRedirects: 3 },
					);
					if (!response.ok) {
						await response.body?.cancel().catch(() => undefined);
						return null;
					}
					const text = await readResponseTextWithinLimit(
						response,
						options.maxContentLength,
						controller,
					);
					const post = parseNaointendidoPost(JSON.parse(text));
					return post ? reconstructNaointendidoPostHtml(post) : null;
				});
				if (providerHtml) return providerHtml;
			} catch (error) {
				logger.warn('Article provider lookup failed; using canonical page', {
					canonicalUrl,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		return await withAttemptTimeout(async (controller) => {
			const response = await fetchWithValidatedRedirects(
				canonicalUrl,
				{
					signal: controller.signal,
					headers: {
						'User-Agent': 'SelfFeed/1.0',
						Accept: 'text/html,application/xhtml+xml',
					},
				},
				{ allowPrivateHosts: options.allowPrivateHosts, maxRedirects: 3 },
			);
			if (!response.ok) {
				await response.body?.cancel().catch(() => undefined);
				return null;
			}
			const contentLength = response.headers?.get?.('content-length');
			if (contentLength && Number.parseInt(contentLength, 10) > options.maxContentLength) {
				await response.body?.cancel().catch(() => undefined);
				return null;
			}
			const pageHtml = await readResponseTextWithinLimit(
				response,
				options.maxContentLength,
				controller,
			);
			return extractArticleContentFromPage(pageHtml);
		});
	} catch (error) {
		logger.warn('Unable to enrich article from canonical page', {
			canonicalUrl,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}
