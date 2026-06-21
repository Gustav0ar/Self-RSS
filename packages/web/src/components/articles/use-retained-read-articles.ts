import type { ArticleListItem, SortOrder } from '@self-feed/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	mergeRetainedReadArticles,
	type RetainedReadArticle,
} from '@/components/articles/feed-view-model';

export function useRetainedReadArticles({
	categoryId,
	feedId,
	fetchedArticles,
	sort,
	unreadOnly,
}: {
	categoryId?: string;
	feedId?: string;
	fetchedArticles: readonly ArticleListItem[];
	sort: SortOrder;
	unreadOnly: boolean;
}) {
	const [retainedReadArticles, setRetainedReadArticles] = useState<
		Map<string, RetainedReadArticle>
	>(() => new Map());
	const retentionScope = `${feedId ?? 'all'}:${categoryId ?? 'all'}:${sort}:${unreadOnly}`;
	const previousRetentionScope = useRef(retentionScope);

	const resetRetainedReadArticles = useCallback(() => {
		setRetainedReadArticles(new Map());
	}, []);

	const retainReadArticle = useCallback(
		(article: ArticleListItem, index: number) => {
			if (!unreadOnly) {
				return;
			}

			setRetainedReadArticles((current) => {
				const retainedArticle = { ...article, isRead: true };
				const previous = current.get(article.id);
				if (
					previous?.index === index &&
					previous.article.isRead === retainedArticle.isRead &&
					previous.article.title === retainedArticle.title
				) {
					return current;
				}

				const next = new Map(current);
				next.set(article.id, { article: retainedArticle, index });
				return next;
			});
		},
		[unreadOnly],
	);

	useEffect(() => {
		if (previousRetentionScope.current === retentionScope) {
			return;
		}
		previousRetentionScope.current = retentionScope;
		resetRetainedReadArticles();
	}, [resetRetainedReadArticles, retentionScope]);

	const articles = useMemo(
		() => mergeRetainedReadArticles(fetchedArticles, retainedReadArticles, unreadOnly),
		[fetchedArticles, retainedReadArticles, unreadOnly],
	);

	return {
		articles,
		resetRetainedReadArticles,
		retainReadArticle,
	};
}
