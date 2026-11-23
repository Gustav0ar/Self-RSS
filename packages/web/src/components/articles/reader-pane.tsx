import { useRouter } from '@tanstack/react-router';
import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft, ArrowRight, BookOpen, RefreshCw, Sparkles } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	useArticle,
	useMarkRead,
	usePreferences,
	useSetArticleSaved,
	useUpdatePreferences,
} from '@/hooks/queries';
import { normalizeAutoMarkReadPreference } from '@/lib/preferences';
import { trackArticleCompletion } from '@/lib/product-analytics';
import { sanitizeArticleHtml } from '@/lib/sanitize-article';
import { OfflineTextStatus } from './offline-text-status';
import { ReaderCompactActions, ReaderPrimaryActions } from './reader-actions';
import {
	estimateReadingMinutes,
	MetadataLine,
	QueueButton,
	ReaderImageLightbox,
	ReaderSkeleton,
} from './reader-chrome';
import {
	useReaderScrollProgress,
	useSelectedArticleEnrichment,
	useTwitterEmbedResize,
} from './reader-effects';
import { getReaderPanelMedia, ReaderMediaPanel } from './reader-media-panel';

interface ReaderPaneProps {
	articleId: string | null;
	articles?: ReaderArticleSummary[];
	onSelectArticle?: (id: string) => void;
}

export interface ReaderArticleSummary {
	id: string;
	feedId: string;
	feedTitle: string;
	feedFaviconUrl: string | null;
	title: string;
	author: string | null;
	excerpt: string | null;
	heroImageUrl: string | null;
	publishedAt: string | null;
	isRead: boolean;
	isSaved: boolean;
}

export function ReaderPane({ articleId, articles = [], onSelectArticle }: ReaderPaneProps) {
	const { data: article, isLoading, isError, isFetching, refetch } = useArticle(articleId);
	const { data: prefs } = usePreferences();
	const updatePreferences = useUpdatePreferences();
	const markRead = useMarkRead();
	const setArticleSaved = useSetArticleSaved();
	const router = useRouter();
	const lastAutoMarkedId = useRef<string | null>(null);
	const [lightboxImage, setLightboxImage] = useState<{
		articleId: string | null;
		src: string;
		alt: string;
	} | null>(null);
	const activeLightboxImage =
		lightboxImage && lightboxImage.articleId === articleId ? lightboxImage : null;
	const readerArticleId = article?.id === articleId ? articleId : null;
	const { scrollerRef, scrollProgressRef } = useReaderScrollProgress(
		readerArticleId,
		trackArticleCompletion,
	);
	useTwitterEmbedResize(scrollerRef);
	useSelectedArticleEnrichment(articleId, article);

	const isRead = article?.isRead;
	const readerHtml = useMemo(() => {
		const html = article?.contentHtml ?? '';
		return sanitizeArticleHtml(html, article?.title);
	}, [article?.contentHtml, article?.title]);
	const readingMinutes = useMemo(
		() => estimateReadingMinutes(article?.contentText, readerHtml),
		[article?.contentText, readerHtml],
	);
	const mediaToRender = useMemo(() => getReaderPanelMedia(article?.media ?? []), [article?.media]);

	const handleCloseLightbox = useCallback(() => setLightboxImage(null), []);
	const handleContentClick = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			const target = event.target;
			if (target instanceof HTMLImageElement && target.src) {
				event.preventDefault();
				setLightboxImage({
					articleId,
					src: target.currentSrc || target.src,
					alt: target.alt || '',
				});
			}
		},
		[articleId],
	);
	const handleUpdateTypography = useCallback(
		(patch: { fontFamily?: string; textSize?: number }) => updatePreferences.mutate(patch),
		[updatePreferences],
	);
	// The following `useMemo` calls must run unconditionally (before
	// the loading / not-found early returns) to satisfy the rules of
	// hooks. They default to safe values when `article` is null.
	const publishedAt = useMemo(
		() =>
			article?.publishedAt
				? formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })
				: null,
		[article?.publishedAt],
	);
	const hasContent = useMemo(() => Boolean(readerHtml.trim()), [readerHtml]);
	const currentIndex = useMemo(
		() => (article ? articles.findIndex((item) => item.id === article.id) : -1),
		[articles, article],
	);
	const previousArticle = useMemo(
		() => (currentIndex > 0 ? (articles[currentIndex - 1] ?? null) : null),
		[currentIndex, articles],
	);
	const nextArticle = useMemo(
		() =>
			currentIndex >= 0 && currentIndex < articles.length - 1
				? (articles[currentIndex + 1] ?? null)
				: null,
		[currentIndex, articles],
	);
	const moreFromFeed = useMemo(
		() =>
			article
				? articles
						.filter((item) => item.feedId === article.feedId && item.id !== article.id)
						.slice(0, 4)
				: [],
		[articles, article],
	);
	const autoMarkReadMode = normalizeAutoMarkReadPreference(prefs?.autoMarkReadMode);

	useEffect(() => {
		if (!articleId) return;
		performance.mark(`article-open-${articleId}`);
	}, [articleId]);

	useEffect(() => {
		if (!article || article.id !== articleId) return;
		const start = `article-open-${article.id}`;
		const measure = `article-detail-ready-${article.id}`;
		try {
			performance.measure(measure, start);
		} catch {
			// The start mark may have been evicted; telemetry must never affect reading.
		}
	}, [article, articleId]);

	useEffect(() => {
		if (!articleId) {
			lastAutoMarkedId.current = null;
			return;
		}
		if (article?.isRead) {
			lastAutoMarkedId.current = articleId;
			return;
		}
		if (
			autoMarkReadMode === 'on_open' &&
			article &&
			!isRead &&
			lastAutoMarkedId.current !== articleId
		) {
			lastAutoMarkedId.current = articleId;
			markRead.mutate(
				{ articleId, read: true },
				{
					onError: () => {
						lastAutoMarkedId.current = null;
					},
				},
			);
		}
	}, [articleId, isRead, article, autoMarkReadMode, markRead]);

	if (!articleId) {
		return (
			<div className="flex h-full items-center justify-center px-6 py-10">
				<div className="motion-scale max-w-md text-center text-muted-foreground">
					<div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-primary/10 text-primary">
						<BookOpen className="h-8 w-8" />
					</div>
					<h2 className="mt-6 text-xl font-semibold text-foreground">Select an article to read</h2>
					<p className="mt-3 text-sm leading-7">
						Choose a story from the left to open the focused reading view.
					</p>
					<p className="mt-4 text-xs">
						Use{' '}
						<kbd className="rounded-full border border-border px-2 py-1 font-mono text-xs">j</kbd> /
						<kbd className="ml-1 rounded-full border border-border px-2 py-1 font-mono text-xs">
							k
						</kbd>{' '}
						to navigate
					</p>
				</div>
			</div>
		);
	}

	const mobileBar = (
		<div className="reader-mobile-bar">
			<button
				type="button"
				onClick={() => {
					if (window.history.length > 1) {
						router.history.back();
					} else {
						void router.navigate({ to: '/' });
					}
				}}
				className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background/60 text-muted-foreground hover:bg-accent hover:text-foreground"
				aria-label="Back to article list"
			>
				<ArrowLeft className="h-4 w-4" />
			</button>
			{article ? (
				<p className="line-clamp-1 min-w-0 flex-1 text-sm font-medium text-foreground">
					{article.title}
				</p>
			) : null}
		</div>
	);

	if (isLoading || isError || !article) {
		return (
			<div className="flex h-full flex-col">
				{mobileBar}
				{isLoading ? (
					<ReaderSkeleton />
				) : (
					<div className="flex flex-1 items-center justify-center px-6 py-10">
						{isError ? (
							<div className="text-center">
								<p className="text-sm font-medium text-foreground">Could not load this article</p>
								<p className="mt-1 text-xs text-muted-foreground">
									Check your connection and try again.
								</p>
								<button
									type="button"
									onClick={() => void refetch()}
									disabled={isFetching}
									className="mt-4 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
								>
									<RefreshCw className="h-4 w-4" />
									Retry
								</button>
							</div>
						) : (
							<p className="text-sm text-muted-foreground">Article not found</p>
						)}
					</div>
				)}
			</div>
		);
	}

	function toggleRead() {
		if (!articleId) {
			return;
		}
		markRead.mutate({ articleId, read: !article?.isRead });
	}

	function toggleSaved() {
		if (!articleId) return;
		setArticleSaved.mutate({ articleId, saved: !article?.isSaved });
	}

	return (
		<div ref={scrollerRef} className="h-full overflow-auto">
			<div
				ref={scrollProgressRef}
				className="reader-scroll-progress"
				style={{ transform: 'scaleX(0)' }}
				aria-hidden="true"
			/>
			{mobileBar}
			<article className="grid min-h-full gap-5 px-4 py-4 sm:px-5 lg:px-6 2xl:grid-cols-[minmax(0,1fr)_20rem]">
				<div className="min-w-0">
					<header className="motion-enter max-w-[82ch]">
						<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
							{article.feedFaviconUrl ? (
								<img
									src={article.feedFaviconUrl}
									alt=""
									className="h-4 w-4 rounded-sm"
									loading="lazy"
									decoding="async"
									referrerPolicy="no-referrer"
								/>
							) : null}
							<span>{article.feedTitle}</span>
							{publishedAt ? (
								<>
									<span>·</span>
									<span>{publishedAt}</span>
								</>
							) : null}
							{readingMinutes ? (
								<>
									<span>·</span>
									<span>{readingMinutes} min read</span>
								</>
							) : null}
							<div className="surface-muted inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.16em]">
								<Sparkles className="h-3 w-3 text-primary" />
								Reader mode
							</div>
						</div>
						<h1 className="mt-3 text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">
							{article.canonicalUrl ? (
								<a
									href={article.canonicalUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="transition-colors hover:text-primary"
								>
									{article.title}
								</a>
							) : (
								article.title
							)}
						</h1>
						{article.author ? (
							<p className="mt-2 text-sm text-muted-foreground">by {article.author}</p>
						) : null}

						<ReaderPrimaryActions
							canonicalUrl={article.canonicalUrl}
							isRead={article.isRead}
							isSaved={article.isSaved}
							saveDisabled={setArticleSaved.isPending}
							onToggleRead={toggleRead}
							onToggleSaved={toggleSaved}
							typography={{
								fontFamily: prefs?.fontFamily ?? 'Inter',
								textSize: prefs?.textSize ?? 16,
								onUpdateTypography: handleUpdateTypography,
							}}
						/>
						<OfflineTextStatus articleId={article.id} />
					</header>

					{hasContent ? (
						// biome-ignore lint/a11y/noStaticElementInteractions: Delegated click-to-zoom for sanitized article images
						// biome-ignore lint/a11y/useKeyWithClickEvents: Delegated image click handler
						<div
							onClick={handleContentClick}
							className="reader-content motion-enter mt-5 max-w-[82ch] border-t border-border/70 pt-5"
							// biome-ignore lint/security/noDangerouslySetInnerHtml: Sanitized content from API
							dangerouslySetInnerHTML={{ __html: readerHtml }}
						/>
					) : article.excerpt ? (
						<div className="motion-enter mt-5 max-w-[82ch] border-t border-border/70 pt-5 leading-8 text-foreground [font-size:var(--reader-text-size,1rem)]">
							<p>{article.excerpt}</p>
						</div>
					) : null}

					<ReaderMediaPanel media={mediaToRender} />
				</div>

				<aside className="hidden min-w-0 2xl:block">
					<div className="sticky top-4 space-y-3">
						{article.heroImageUrl ? (
							<button
								type="button"
								onClick={() =>
									setLightboxImage({
										articleId,
										src: article.heroImageUrl!,
										alt: article.title,
									})
								}
								aria-label="Inspect hero image"
								className="block w-full cursor-zoom-in overflow-hidden rounded-xl"
							>
								<img
									src={article.heroImageUrl}
									alt=""
									className="aspect-video w-full object-cover"
									loading="lazy"
									decoding="async"
									referrerPolicy="no-referrer"
								/>
							</button>
						) : null}

						<div className="surface-card surface-compact rounded-xl p-4">
							<p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
								Article
							</p>
							<div className="mt-3 space-y-3 text-sm">
								<MetadataLine label="Source" value={article.feedTitle} />
								{article.author ? <MetadataLine label="Author" value={article.author} /> : null}
								{publishedAt ? <MetadataLine label="Published" value={publishedAt} /> : null}
								{readingMinutes ? (
									<MetadataLine label="Reading time" value={`${readingMinutes} min read`} />
								) : null}
							</div>
							<ReaderCompactActions
								canonicalUrl={article.canonicalUrl}
								isRead={article.isRead}
								isSaved={article.isSaved}
								saveDisabled={setArticleSaved.isPending}
								onToggleRead={toggleRead}
								onToggleSaved={toggleSaved}
							/>
						</div>

						{onSelectArticle && (previousArticle || nextArticle) ? (
							<div className="surface-card surface-compact rounded-xl p-3">
								<p className="px-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
									Queue
								</p>
								<div className="mt-2 grid gap-2">
									<QueueButton
										article={previousArticle}
										icon={<ArrowLeft className="h-3.5 w-3.5" />}
										label="Previous"
										onSelectArticle={onSelectArticle}
									/>
									<QueueButton
										article={nextArticle}
										icon={<ArrowRight className="h-3.5 w-3.5" />}
										label="Next"
										onSelectArticle={onSelectArticle}
									/>
								</div>
							</div>
						) : null}

						{onSelectArticle && moreFromFeed.length > 0 ? (
							<div className="surface-card surface-compact rounded-xl p-3">
								<p className="px-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
									More from this feed
								</p>
								<div className="mt-2 space-y-1">
									{moreFromFeed.map((item) => (
										<button
											key={item.id}
											type="button"
											onClick={() => onSelectArticle(item.id)}
											className="w-full rounded-lg px-2 py-2 text-left text-xs leading-5 hover:bg-accent"
										>
											<span className="line-clamp-2 font-medium text-foreground">{item.title}</span>
											{item.publishedAt ? (
												<span className="mt-0.5 block text-muted-foreground">
													{formatDistanceToNow(new Date(item.publishedAt), { addSuffix: true })}
												</span>
											) : null}
										</button>
									))}
								</div>
							</div>
						) : null}
					</div>
				</aside>
			</article>
			{activeLightboxImage ? (
				<ReaderImageLightbox image={activeLightboxImage} onClose={handleCloseLightbox} />
			) : null}
		</div>
	);
}
