import type { PublisherScheduleHints } from './feed-publisher-hints.js';

export interface NormalizedFeedMedia {
	url: string;
	type: string | null;
	medium: string | null;
	width: number | null;
	height: number | null;
	length: number | null;
}

export interface NormalizedFeedItem {
	guid: string;
	canonicalUrl: string | null;
	title: string;
	author: string | null;
	summary: string | null;
	contentHtml: string | null;
	contentText: string | null;
	media: NormalizedFeedMedia[];
	categories: string[];
	publishedAt: string | null;
	updatedAt: string | null;
}

export interface NormalizedFeedSourceMetadata {
	title: string | null;
	siteUrl: string | null;
	description: string | null;
	language: string | null;
	imageUrl: string | null;
}

export interface NormalizedFeedPayload {
	format: 'rss' | 'rdf' | 'atom' | 'json-feed';
	parserVersion: string;
	rawBodyHash: string;
	normalizedPayloadHash: string;
	source: NormalizedFeedSourceMetadata;
	items: NormalizedFeedItem[];
	publisherHints: PublisherScheduleHints;
}
