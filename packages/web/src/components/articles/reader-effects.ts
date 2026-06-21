import type { RefObject } from 'react';
import { useEffect, useLayoutEffect, useRef } from 'react';

export function useReaderScrollProgress(articleId: string | null) {
	const scrollerRef = useRef<HTMLDivElement | null>(null);
	const scrollProgressRef = useRef<HTMLDivElement | null>(null);
	const scrollProgressFrame = useRef<number | null>(null);

	useLayoutEffect(() => {
		if (!articleId) return;
		const node = scrollerRef.current;
		if (!node) return;

		node.scrollTop = 0;
		if (scrollProgressFrame.current != null) {
			if (typeof window.cancelAnimationFrame === 'function') {
				window.cancelAnimationFrame(scrollProgressFrame.current);
			}
			scrollProgressFrame.current = null;
		}
		if (scrollProgressRef.current) {
			scrollProgressRef.current.style.transform = 'scaleX(0)';
		}
	}, [articleId]);

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

	return { scrollerRef, scrollProgressRef };
}

export function useTwitterEmbedResize(scrollerRef: RefObject<HTMLDivElement | null>) {
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			if (event.origin !== 'https://platform.twitter.com') {
				return;
			}

			const data = event.data;
			if (data?.['twttr.embed']?.method !== 'twttr.private.resize') {
				return;
			}

			const height = data['twttr.embed'].params?.[0]?.height;
			if (typeof height !== 'number') {
				return;
			}

			const tweetId = data['twttr.embed'].params?.[0]?.data?.tweet_id;
			const root = scrollerRef.current;
			if (!root) return;

			const iframes = root.querySelectorAll<HTMLIFrameElement>(
				'iframe[src*="platform.twitter.com"]',
			);
			let twitterIframesCount = 0;
			let singleTwitterIframe: HTMLIFrameElement | null = null;
			for (const iframe of iframes) {
				twitterIframesCount++;
				singleTwitterIframe = iframe;
			}

			for (const iframe of iframes) {
				const iframeTweetId = iframe.src.match(/[?&]id=(\d+)/)?.[1];
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
		};

		window.addEventListener('message', handleMessage);
		return () => {
			window.removeEventListener('message', handleMessage);
		};
	}, [scrollerRef]);
}
