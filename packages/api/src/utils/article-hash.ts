import { createHash } from 'node:crypto';

export interface ArticleHashInput {
	canonicalUrl?: string | null;
	title?: string | null;
	author?: string | null;
	excerpt?: string | null;
	contentHtml?: string | null;
	contentText?: string | null;
	heroImageUrl?: string | null;
}

export function createArticleContentHash(input: ArticleHashInput): string {
	return createHash('sha256')
		.update(
			JSON.stringify({
				canonicalUrl: input.canonicalUrl ?? null,
				title: input.title ?? null,
				author: input.author ?? null,
				excerpt: input.excerpt ?? null,
				contentHtml: input.contentHtml ?? null,
				contentText: input.contentText ?? null,
				heroImageUrl: input.heroImageUrl ?? null,
			}),
		)
		.digest('hex');
}
