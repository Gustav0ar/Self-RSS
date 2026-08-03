import type { ArticleMedia } from '@self-feed/shared';

type ReaderPanelMedia = ArticleMedia & { type: 'video' | 'embed' };

export function getReaderPanelMedia(media: ArticleMedia[]) {
	return media.filter(
		(item): item is ReaderPanelMedia => item.type === 'video' || item.type === 'embed',
	);
}

function isXEmbed(item: ReaderPanelMedia) {
	if (item.provider === 'x') return true;

	try {
		const url = new URL(item.embedUrl ?? item.url);
		return url.hostname === 'platform.twitter.com' && url.pathname === '/embed/Tweet.html';
	} catch {
		return false;
	}
}

export function ReaderMediaPanel({ media }: { media: ReaderPanelMedia[] }) {
	if (media.length === 0) return null;

	return (
		<div className="surface-card motion-enter mt-6 space-y-4 rounded-xl p-4 dark:bg-black sm:p-5">
			{media.map((item, index) => {
				if (item.type === 'video') {
					return (
						<div
							key={item.url}
							className="overflow-hidden rounded-xl border border-border/70 bg-muted"
							style={{
								aspectRatio:
									item.width && item.height ? `${item.width} / ${item.height}` : '16 / 9',
							}}
						>
							{/* biome-ignore lint/a11y/useMediaCaption: RSS media records do not include caption track metadata. */}
							<video
								src={item.url}
								title={`Media ${index + 1}`}
								className="h-full w-full bg-black"
								controls
								preload="metadata"
								playsInline
							/>
						</div>
					);
				}

				const isX = isXEmbed(item);
				return (
					<div
						key={item.url}
						className={`overflow-hidden rounded-xl border border-border/70 bg-muted dark:bg-black ${
							isX ? 'mx-auto w-full max-w-[560px]' : ''
						}`}
						style={
							isX
								? { height: '600px' }
								: {
										aspectRatio:
											item.width && item.height ? `${item.width} / ${item.height}` : '16 / 9',
									}
						}
					>
						<iframe
							src={item.embedUrl ?? item.url}
							title={`Media ${index + 1}`}
							className="h-full w-full"
							loading="lazy"
							referrerPolicy="strict-origin-when-cross-origin"
							sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
							scrolling={isX ? 'no' : undefined}
							style={isX ? { overflow: 'hidden' } : undefined}
							allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture"
							allowFullScreen
						/>
					</div>
				);
			})}
		</div>
	);
}
