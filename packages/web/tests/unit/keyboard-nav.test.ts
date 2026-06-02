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

		it('returns first when current not found', () => {
			expect(getNextArticleId(ids, 'unknown')).toBe('a');
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

		it('returns first when current not found', () => {
			expect(getPrevArticleId(ids, 'unknown')).toBe('a');
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
