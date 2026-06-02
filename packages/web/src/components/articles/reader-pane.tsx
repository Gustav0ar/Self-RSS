import { formatDistanceToNow } from 'date-fns';
import { BookOpen, Eye, EyeOff, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useArticle, useEnrichArticle, useMarkRead } from '@/hooks/queries';

interface ReaderPaneProps {
	articleId: string | null;
}

export function ReaderPane({ articleId }: ReaderPaneProps) {
	const { data: article, isLoading } = useArticle(articleId);
	const markRead = useMarkRead();
	const enrichArticle = useEnrichArticle();
	const lastAutoMarkedId = useRef<string | null>(null);
	const lastEnrichedId = useRef<string | null>(null);

	const isRead = article?.isRead;
	const contentHtmlWithoutEmbeddedMedia = useMemo(() => {
		const html = article?.contentHtml ?? '';
		if (!html.includes('embedded-media')) {
			return html;
		}
		const doc = new DOMParser().parseFromString(html, 'text/html');
		doc.querySelectorAll('iframe.embedded-media').forEach((iframe) => {
			const parent = iframe.parentElement;
			iframe.remove();
			if (
				parent &&
				['P', 'DIV', 'FIGURE', 'SECTION', 'ARTICLE'].includes(parent.tagName) &&
				parent.childElementCount === 0 &&
				!parent.textContent?.trim()
			) {
				parent.remove();
			}
		});
		return doc.body.innerHTML;
	}, [article?.contentHtml]);
	const mediaToRender = (article?.media ?? []).filter(
		(media) => media.type === 'video' || media.type === 'embed',
	);

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
			lastEnrichedId.current = null;
			return;
		}
		if (article?.isRead) {
			lastAutoMarkedId.current = articleId;
			return;
		}
		if (article && !isRead && lastAutoMarkedId.current !== articleId) {
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
	}, [articleId, isRead, article, markRead]);

	useEffect(() => {
		if (!articleId || !article?.canonicalUrl || article.isEnriched || enrichArticle.isPending) {
			return;
		}
		if (lastEnrichedId.current === articleId) {
			return;
		}

		lastEnrichedId.current = articleId;
		enrichArticle.mutate(articleId, {
			onError: () => {
				lastEnrichedId.current = null;
			},
		});
	}, [articleId, article, enrichArticle]);

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

	const publishedAt = article.publishedAt
		? formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })
		: null;
	const hasContent = Boolean(contentHtmlWithoutEmbeddedMedia.trim());

	function toggleRead() {
		if (!articleId) {
			return;
		}
		markRead.mutate({ articleId, read: !article?.isRead });
	}

	return (
		<div className="h-full overflow-auto">
			<article className="mx-auto max-w-5xl px-5 py-6 sm:px-6 lg:px-8 lg:py-8">
				<header className="surface-card motion-enter rounded-[1.75rem] px-6 py-6 sm:px-8 sm:py-8">
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
						<div className="surface-muted ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.18em]">
							<Sparkles className="h-3 w-3 text-primary" />
							Reader mode
						</div>
					</div>
					<h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
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
						<p className="mt-3 text-sm text-muted-foreground">by {article.author}</p>
					) : null}

					<div className="mt-6 flex flex-wrap items-center gap-2">
						<button
							type="button"
							onClick={toggleRead}
							className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-medium hover:bg-accent"
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
					</div>
				</header>

				{hasContent ? (
					<div
						className="reader-content surface-card motion-enter mt-6 rounded-[1.75rem] px-6 py-6 sm:px-8 sm:py-8"
						// biome-ignore lint/security/noDangerouslySetInnerHtml: Sanitized content from API
						dangerouslySetInnerHTML={{ __html: contentHtmlWithoutEmbeddedMedia }}
					/>
				) : article.excerpt ? (
					<div className="surface-card motion-enter mt-6 rounded-[1.75rem] px-6 py-6 text-base leading-8 text-foreground sm:px-8 sm:py-8">
						<p>{article.excerpt}</p>
					</div>
				) : null}

				{mediaToRender.length > 0 ? (
					<div className="surface-card motion-enter mt-6 space-y-4 rounded-[1.75rem] p-5 sm:p-6">
						{mediaToRender.map((m, i) => {
							if (m.type === 'image') {
								return (
									<img
										key={m.url}
										src={m.url}
										alt=""
										className="max-w-full rounded-2xl"
										loading="lazy"
									/>
								);
							}
							if (m.type === 'video' || m.type === 'embed') {
								const isX = (m.provider as string) === 'x';
								return (
									<div
										key={m.url}
										className={`overflow-hidden rounded-[1.35rem] border border-border/70 bg-muted ${
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
			</article>
		</div>
	);
}
