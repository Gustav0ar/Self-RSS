import { describe, expect, it } from 'vitest';
import { OpmlExportService } from '../../src/services/opml-export.service.js';

describe('OpmlExportService', () => {
	it('serializes nested categories and feeds into OPML outlines', async () => {
		const service = new OpmlExportService(
			{
				findAllByUser: async () => [
					{
						id: 'cat-1',
						userId: 'user-1',
						parentCategoryId: null,
						name: 'Engineering',
						slug: 'engineering',
						sortOrder: 0,
						createdAt: '2026-03-11T00:00:00.000Z',
						updatedAt: '2026-03-11T00:00:00.000Z',
					},
					{
						id: 'cat-2',
						userId: 'user-1',
						parentCategoryId: 'cat-1',
						name: 'Frontend',
						slug: 'frontend',
						sortOrder: 0,
						createdAt: '2026-03-11T00:00:00.000Z',
						updatedAt: '2026-03-11T00:00:00.000Z',
					},
				],
			} as never,
			{
				findAllByUser: async () => [
					{
						id: 'feed-1',
						userId: 'user-1',
						categoryId: 'cat-2',
						title: 'DevTools Digest',
						siteUrl: 'https://example.com/devtools',
						feedUrl: 'https://example.com/devtools.xml',
						faviconUrl: null,
						description: null,
						pollingIntervalMinutes: 60,
						lastSyncedAt: null,
						syncStatus: 'idle',
						createdAt: '2026-03-11T00:00:00.000Z',
						updatedAt: '2026-03-11T00:00:00.000Z',
					},
				],
			} as never,
		);

		const result = await service.export('user-1');

		expect(result.filename).toMatch(/^self-feed-feeds-\d{4}-\d{2}-\d{2}\.opml$/);
		expect(result.content).toContain('<opml version="2.0">');
		expect(result.content).toContain('<outline text="Engineering" title="Engineering">');
		expect(result.content).toContain('<outline text="Frontend" title="Frontend">');
		expect(result.content).toContain(
			'<outline type="rss" text="DevTools Digest" title="DevTools Digest" xmlUrl="https://example.com/devtools.xml" htmlUrl="https://example.com/devtools" />',
		);
	});

	it('escapes xml-sensitive values in exported outlines', async () => {
		const service = new OpmlExportService(
			{
				findAllByUser: async () => [],
			} as never,
			{
				findAllByUser: async () => [
					{
						id: 'feed-1',
						userId: 'user-1',
						categoryId: null,
						title: 'Research & Development <Daily>',
						siteUrl: 'https://example.com/?a=1&b=2',
						feedUrl: 'https://example.com/feed?kind=<rss>',
						faviconUrl: null,
						description: null,
						pollingIntervalMinutes: 60,
						lastSyncedAt: null,
						syncStatus: 'idle',
						createdAt: '2026-03-11T00:00:00.000Z',
						updatedAt: '2026-03-11T00:00:00.000Z',
					},
				],
			} as never,
		);

		const result = await service.export('user-1');

		expect(result.content).toContain('Research &amp; Development &lt;Daily&gt;');
		expect(result.content).toContain('xmlUrl="https://example.com/feed?kind=&lt;rss&gt;"');
		expect(result.content).toContain('htmlUrl="https://example.com/?a=1&amp;b=2"');
	});
});
