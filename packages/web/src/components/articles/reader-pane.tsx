import { useRouter } from '@tanstack/react-router';
import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft, ArrowRight, BookOpen, ExternalLink, Eye, EyeOff, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useArticle, useEnrichArticle, useMarkRead, usePreferences } from '@/hooks/queries';
import { normalizeAutoMarkReadPreference } from '@/lib/preferences';
import { sanitizeArticleHtml } from '@/lib/sanitize-article';

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
}

function prepareReaderHtml(html: string) {
	// The API sanitizes content before persisting; this client-side
	// pass re-validates against the same allowlist (defense in depth)
	// and adds presentation attributes for the web surface.
	return sanitizeArticleHtml(html);
}

export function ReaderPane({ articleId, articles = [], onSelectArticle }: ReaderPaneProps) {
	const { data: article, isLoading } = useArticle(articleId);
	const { data: prefs } = usePreferences();
	const markRead = useMarkRead();
	const enrichArticle = useEnrichArticle();
	const router = useRouter();
	const lastAutoMarkedId = useRef<string | null>(null);
	const enrichmentAttemptedIds = useRef(new Set<string>());
	const scrollerRef = useRef<HTMLDivElement | null>(null);
	const scrollProgressRef = useRef<HTMLDivElement | null>(null);
	const scrollProgressFrame = useRef<number | null>(null);

	useEffect(() => {
		const node = scrollerRef.current;
		if (!node) return;

		const updateProgress = () => {
			scrollProgressFrame.current = null;
			const max = node.scrollHeight - node.clientHeight;
			const ratio = max <= 0 ? 0 : Math.min(1, Math.max(0, node.scrollTop / max));
			if (scrollProgressRef.current) {
				scrollProgressRef.current.style.transform = `scaleX(${ratio})`;
			}
		};

		const scheduleProgressUpdate = () => {
			if (scrollProgressFrame.current != null) {
				return;
			}
			if (typeof window.requestAnimationFrame !== 'function') {
				updateProgress();
				return;
			}
			scrollProgressFrame.current = window.requestAnimationFrame(updateProgress);
		};

		updateProgress();
		node.addEventListener('scroll', scheduleProgressUpdate, { passive: true });
		const observer =
			typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleProgressUpdate) : null;
		observer?.observe(node);
		return () => {
			node.removeEventListener('scroll', scheduleProgressUpdate);
			if (scrollProgressFrame.current != null) {
				if (typeof window.cancelAnimationFrame === 'function') {
					window.cancelAnimationFrame(scrollProgressFrame.current);
				}
				scrollProgressFrame.current = null;
			}
			observer?.disconnect();
		};
	}, []);

	const isRead = article?.isRead;
	const readerHtml = useMemo(() => {
		const html = article?.contentHtml ?? '';
		return prepareReaderHtml(html);
	}, [article?.contentHtml]);
	const mediaToRender = useMemo(
		() =>
			(article?.media ?? []).filter((media) => media.type === 'video' || media.type === 'embed'),
		[article?.media],
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
		if (!article || article.isEnriched || !article.canonicalUrl?.trim()) {
			return;
		}
		if (enrichmentAttemptedIds.current.has(article.id)) {
			return;
		}

		enrichmentAttemptedIds.current.add(article.id);
		enrichArticle.mutate(article.id, {
			onError: () => {
				enrichmentAttemptedIds.current.delete(article.id);
			},
		});
	}, [article, enrichArticle]);

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			if (event.origin !== 'https://platform.twitter.com') {
				return;
			}

			const data = event.data;
			if (data?.['twttr.embed']?.method === 'twttr.private.resize') {
				const height = data['twttr.embed'].params?.[0]?.height;
				if (typeof height === 'number') {
					const tweetId = data['twttr.embed'].params?.[0]?.data?.tweet_id;
					const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe');
					let twitterIframesCount = 0;
					let singleTwitterIframe: HTMLIFrameElement | null = null;
					for (const iframe of iframes) {
						if (iframe.src.includes('platform.twitter.com')) {
							twitterIframesCount++;
							singleTwitterIframe = iframe;
						}
					}

					for (const iframe of iframes) {
						const src = iframe.src;
						if (!src.includes('platform.twitter.com')) {
							continue;
						}
						const iframeTweetId = src.match(/[?&]id=(\d+)/)?.[1];
						const matchesTweetId =
							tweetId && iframeTweetId && String(tweetId) === String(iframeTweetId);

						if (matchesTweetId || (twitterIframesCount === 1 && iframe === singleTwitterIframe)) {
							iframe.style.height = `${height}px`;
							const parent = iframe.parentElement;
							if (parent) {
								parent.style.height = 'auto';
							}
						}
					}
				}
			}
		};

		window.addEventListener('message', handleMessage);
		return () => {
			window.removeEventListener('message', handleMessage);
		};
	}, []);

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

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center px-6 py-10">
				<p className="text-sm text-muted-foreground">Loading article...</p>
			</div>
		);
	}

	if (!article) {
		return (
			<div className="flex h-full items-center justify-center px-6 py-10">
				<p className="text-sm text-muted-foreground">Article not found</p>
			</div>
		);
	}

	function toggleRead() {
		if (!articleId) {
			return;
		}
		markRead.mutate({ articleId, read: !article?.isRead });
	}

	return (
		<div ref={scrollerRef} className="h-full overflow-auto">
			<div
				ref={scrollProgressRef}
				className="reader-scroll-progress"
				style={{ transform: 'scaleX(0)' }}
				aria-hidden="true"
			/>
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
				<p className="line-clamp-1 min-w-0 flex-1 text-sm font-medium text-foreground">
					{article.title}
				</p>
			</div>
			<article className="grid min-h-full gap-5 px-4 py-4 sm:px-5 lg:px-6 2xl:grid-cols-[minmax(0,1fr)_20rem]">
				<div className="min-w-0">
					<header className="motion-enter max-w-[82ch]">
						<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
							{article.feedFaviconUrl ? (
								<img src={article.feedFaviconUrl} alt="" className="h-4 w-4 rounded-sm" />
							) : null}
							<span>{article.feedTitle}</span>
							{publishedAt ? (
								<>
									<span>·</span>
									<span>{publishedAt}</span>
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

						<div className="mt-4 flex flex-wrap items-center gap-2">
							<button
								type="button"
								onClick={toggleRead}
								className="inline-flex h-9 items-center gap-2 rounded-full border border-border px-3 text-xs font-medium hover:bg-accent"
							>
								{article.isRead ? (
									<>
										<EyeOff className="h-3.5 w-3.5" />
										Mark unread
									</>
								) : (
									<>
										<Eye className="h-3.5 w-3.5" />
										Mark read
									</>
								)}
							</button>
							{article.canonicalUrl ? (
								<a
									href={article.canonicalUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex h-9 items-center gap-2 rounded-full border border-border px-3 text-xs font-medium hover:bg-accent"
								>
									<ExternalLink className="h-3.5 w-3.5" />
									Original
								</a>
							) : null}
						</div>
					</header>

					{hasContent ? (
						<div
							className="reader-content motion-enter mt-5 max-w-[82ch] border-t border-border/70 pt-5"
							// biome-ignore lint/security/noDangerouslySetInnerHtml: Sanitized content from API
							dangerouslySetInnerHTML={{ __html: readerHtml }}
						/>
					) : article.excerpt ? (
						<div className="motion-enter mt-5 max-w-[82ch] border-t border-border/70 pt-5 leading-8 text-foreground [font-size:var(--reader-text-size,1rem)]">
							<p>{article.excerpt}</p>
						</div>
					) : null}

					{mediaToRender.length > 0 ? (
						<div className="surface-card motion-enter mt-6 space-y-4 rounded-xl p-4 sm:p-5">
							{mediaToRender.map((m, i) => {
								if (m.type === 'image') {
									return (
										<img
											key={m.url}
											src={m.url}
											alt=""
											className="max-w-full rounded-xl"
											loading="lazy"
										/>
									);
								}
								if (m.type === 'video' || m.type === 'embed') {
									const isX = (m.provider as string) === 'x';
									return (
										<div
											key={m.url}
											className={`overflow-hidden rounded-xl border border-border/70 bg-muted ${
												isX ? 'w-full max-w-[560px] mx-auto' : ''
											}`}
											style={
												isX
													? { height: '600px' }
													: {
															aspectRatio:
																m.width && m.height ? `${m.width} / ${m.height}` : '16 / 9',
														}
											}
										>
											<iframe
												src={m.embedUrl ?? m.url}
												title={`Media ${i + 1}`}
												className="h-full w-full"
												scrolling={isX ? 'no' : undefined}
												style={isX ? { overflow: 'hidden' } : undefined}
												allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture"
												allowFullScreen
											/>
										</div>
									);
								}
								return null;
							})}
						</div>
					) : null}
				</div>

				<aside className="hidden min-w-0 2xl:block">
					<div className="sticky top-4 space-y-3">
						{article.heroImageUrl ? (
							<img
								src={article.heroImageUrl}
								alt=""
								className="aspect-video w-full rounded-xl object-cover"
							/>
						) : null}

						<div className="surface-card surface-compact rounded-xl p-4">
							<p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
								Article
							</p>
							<div className="mt-3 space-y-3 text-sm">
								<MetadataLine label="Source" value={article.feedTitle} />
								{article.author ? <MetadataLine label="Author" value={article.author} /> : null}
								{publishedAt ? <MetadataLine label="Published" value={publishedAt} /> : null}
							</div>
							<div className="mt-4 grid grid-cols-2 gap-2">
								<button
									type="button"
									onClick={toggleRead}
									className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border text-xs font-medium hover:bg-accent"
								>
									{article.isRead ? (
										<>
											<EyeOff className="h-3.5 w-3.5" />
											Unread
										</>
									) : (
										<>
											<Eye className="h-3.5 w-3.5" />
											Read
										</>
									)}
								</button>
								{article.canonicalUrl ? (
									<a
										href={article.canonicalUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border text-xs font-medium hover:bg-accent"
									>
										<ExternalLink className="h-3.5 w-3.5" />
										Open
									</a>
								) : (
									<span className="inline-flex h-9 items-center justify-center rounded-lg border border-border text-xs text-muted-foreground">
										No link
									</span>
								)}
							</div>
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
		</div>
	);
}

function MetadataLine({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid gap-1">
			<span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
			<span className="break-words text-foreground">{value}</span>
		</div>
	);
}

function QueueButton({
	article,
	icon,
	label,
	onSelectArticle,
}: {
	article: ReaderArticleSummary | null;
	icon: ReactNode;
	label: string;
	onSelectArticle: (id: string) => void;
}) {
	if (!article) {
		return (
			<span className="flex min-h-14 items-center gap-2 rounded-lg border border-border/70 px-2.5 py-2 text-xs text-muted-foreground/70">
				{icon}
				{label}
			</span>
		);
	}

	return (
		<button
			type="button"
			onClick={() => onSelectArticle(article.id)}
			className="flex min-h-14 items-start gap-2 rounded-lg border border-border/70 px-2.5 py-2 text-left text-xs hover:bg-accent"
		>
			<span className="mt-0.5 text-muted-foreground">{icon}</span>
			<span className="min-w-0">
				<span className="block text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
					{label}
				</span>
				<span className="mt-0.5 line-clamp-2 font-medium leading-5 text-foreground">
					{article.title}
				</span>
			</span>
		</button>
	);
}
