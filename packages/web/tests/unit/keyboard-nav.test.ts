import { describe, expect, it } from 'vitest';
import { getNextArticleId, getPrevArticleId } from '../../src/hooks/use-keyboard-nav';

describe('keyboard navigation helpers', () => {
	const ids = ['a', 'b', 'c', 'd', 'e'];

	describe('getNextArticleId', () => {
		it('returns first article when current is null', () => {
			expect(getNextArticleId(ids, null)).toBe('a');
		});

		it('returns next article', () => {
			expect(getNextArticleId(ids, 'b')).toBe('c');
		});

		it('stays at last when already at end', () => {
			expect(getNextArticleId(ids, 'e')).toBe('e');
		});

		it('keeps the current article when current is not found and no last slot is known', () => {
			expect(getNextArticleId(ids, 'unknown')).toBe('unknown');
		});

		it('uses the last known slot when the current article was removed', () => {
			expect(getNextArticleId(['a', 'b', 'd', 'e'], 'c', { id: 'c', index: 2 })).toBe('d');
		});

		it('keeps the current article when a removed current article was last in the list', () => {
			expect(getNextArticleId(['a', 'b'], 'c', { id: 'c', index: 2 })).toBe('c');
		});

		it('returns null for empty list', () => {
			expect(getNextArticleId([], 'a')).toBeNull();
		});
	});

	describe('getPrevArticleId', () => {
		it('returns first article when current is null', () => {
			expect(getPrevArticleId(ids, null)).toBe('a');
		});

		it('returns previous article', () => {
			expect(getPrevArticleId(ids, 'c')).toBe('b');
		});

		it('stays at first when already at start', () => {
			expect(getPrevArticleId(ids, 'a')).toBe('a');
		});

		it('keeps the current article when current is not found and no last slot is known', () => {
			expect(getPrevArticleId(ids, 'unknown')).toBe('unknown');
		});

		it('uses the previous item from the last known slot when the current article was removed', () => {
			expect(getPrevArticleId(['a', 'b', 'd', 'e'], 'c', { id: 'c', index: 2 })).toBe('b');
		});

		it('keeps the current article when a removed current article was first in the list', () => {
			expect(getPrevArticleId(['b', 'c'], 'a', { id: 'a', index: 0 })).toBe('a');
		});

		it('returns null for empty list', () => {
			expect(getPrevArticleId([], 'a')).toBeNull();
		});
	});
});

describe('read-state transformations', () => {
	it('toggles read state from unread to read', () => {
		const article = { id: '1', isRead: false };
		const toggled = { ...article, isRead: !article.isRead };
		expect(toggled.isRead).toBe(true);
	});

	it('toggles read state from read to unread', () => {
		const article = { id: '1', isRead: true };
		const toggled = { ...article, isRead: !article.isRead };
		expect(toggled.isRead).toBe(false);
	});

	it('marks all articles as read', () => {
		const articles = [
			{ id: '1', isRead: false },
			{ id: '2', isRead: true },
			{ id: '3', isRead: false },
		];
		const allRead = articles.map((a) => ({ ...a, isRead: true }));
		expect(allRead.every((a) => a.isRead)).toBe(true);
	});

	it('filters unread articles only', () => {
		const articles = [
			{ id: '1', isRead: false },
			{ id: '2', isRead: true },
			{ id: '3', isRead: false },
		];
		const unread = articles.filter((a) => !a.isRead);
		expect(unread).toHaveLength(2);
		expect(unread.map((a) => a.id)).toEqual(['1', '3']);
	});
});
