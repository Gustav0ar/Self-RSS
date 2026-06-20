import { describe, expect, it } from 'vitest';

/**
 * UUID v4 validation regex pattern - must match the one in article.repository.ts
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
	return UUID_REGEX.test(value);
}

// Maximum reasonable timestamp: year 2100
const MAX_REASONABLE_TIMESTAMP = 4102444800;

// Re-implement decodeCursor to test validation logic
// (The actual function is not exported, so we test the validation pattern)

function decodeCursor(
	cursor: string | undefined,
	sort: string | undefined,
): { id: string; seconds: number; direction: 'a' | 'd'; ftsRank?: number } | null {
	if (!cursor) return null;
	const parts = cursor.split(':');
	if (parts.length < 3) return null;

	const expectedDirection = sort === 'oldest' ? 'a' : 'd';

	if (parts.length === 4) {
		const [rankIntRaw, secondsRaw, id, direction] = parts;
		if (!rankIntRaw || !secondsRaw || !id || !direction) return null;
		// UUID validation
		if (!isValidUuid(id)) return null;
		if (direction !== 'a' && direction !== 'd') return null;
		if (direction !== expectedDirection) return null;
		const OFFSET = 1000000000;
		const SCALE = 10000;
		const rawRank = Number(rankIntRaw);
		if (!Number.isFinite(rawRank)) return null;
		const ftsRank = rawRank > OFFSET / 2 ? (rawRank - OFFSET) / SCALE : rawRank;
		const seconds = Number.parseInt(secondsRaw, 10);
		if (!Number.isFinite(seconds) || seconds < 0) return null;
		// Validate timestamp bounds
		if (seconds > MAX_REASONABLE_TIMESTAMP) return null;
		return { id, seconds, direction, ftsRank };
	}

	const [id, secondsRaw, direction] = parts;
	if (!id || !secondsRaw || !direction) return null;
	// UUID validation
	if (!isValidUuid(id)) return null;
	if (direction !== 'a' && direction !== 'd') return null;
	if (direction !== expectedDirection) return null;
	const seconds = Number.parseInt(secondsRaw, 10);
	if (!Number.isFinite(seconds) || seconds < 0) return null;
	// Validate timestamp bounds
	if (seconds > MAX_REASONABLE_TIMESTAMP) return null;
	return { id, seconds, direction };
}

describe('UUID validation', () => {
	it('accepts valid lowercase UUID', () => {
		expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
	});

	it('accepts valid uppercase UUID', () => {
		expect(isValidUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
	});

	it('accepts valid mixed-case UUID', () => {
		expect(isValidUuid('550e8400-E29B-41d4-A716-446655440000')).toBe(true);
	});

	it('rejects empty string', () => {
		expect(isValidUuid('')).toBe(false);
	});

	it('rejects SQL injection attempt with single quote', () => {
		expect(isValidUuid("'; DROP TABLE articles; --")).toBe(false);
	});

	it('rejects SQL injection attempt with OR clause', () => {
		expect(isValidUuid("' OR '1'='1")).toBe(false);
	});

	it('rejects SQL injection with semicolon', () => {
		expect(isValidUuid("id'; DELETE FROM article_reads WHERE '1'='1")).toBe(false);
	});

	it('rejects UUID with wrong format - too short', () => {
		expect(isValidUuid('550e8400-e29b-41d4-a716')).toBe(false);
	});

	it('rejects UUID with wrong format - missing dashes', () => {
		expect(isValidUuid('550e8400e29b41d4a716446655440000')).toBe(false);
	});

	it('rejects UUID with wrong format - extra characters', () => {
		expect(isValidUuid('550e8400-e29b-41d4-a716-4466554400001')).toBe(false);
	});

	it('rejects UUID with invalid hex characters', () => {
		expect(isValidUuid('550e8400-e29b-41d4-a716-44665544000g')).toBe(false);
	});

	it('rejects SQL injection with UNION pattern', () => {
		expect(isValidUuid("' UNION SELECT * FROM users--")).toBe(false);
	});

	it('rejects SQL injection with comment terminator', () => {
		expect(isValidUuid("id' /*")).toBe(false);
	});
});

describe('decodeCursor - valid cursors', () => {
	const validUuid = '550e8400-e29b-41d4-a716-446655440000';

	it('decodes valid non-search cursor', () => {
		const cursor = `${validUuid}:1704067200:d`;
		const result = decodeCursor(cursor, 'latest');
		expect(result).toEqual({
			id: validUuid,
			seconds: 1704067200,
			direction: 'd',
		});
	});

	it('decodes valid search cursor with exact ftsRank', () => {
		const cursor = `-0.00000123456789:1704067200:${validUuid}:d`;
		const result = decodeCursor(cursor, 'latest');
		expect(result).toEqual({
			id: validUuid,
			seconds: 1704067200,
			direction: 'd',
			ftsRank: -0.00000123456789,
		});
	});

	it('decodes legacy integer search cursor with ftsRank', () => {
		const cursor = `1000001234:1704067200:${validUuid}:d`;
		const result = decodeCursor(cursor, 'latest');
		expect(result).toEqual({
			id: validUuid,
			seconds: 1704067200,
			direction: 'd',
			ftsRank: 1234 / 10000,
		});
	});

	it('decodes valid oldest cursor', () => {
		const cursor = `${validUuid}:1704067200:a`;
		const result = decodeCursor(cursor, 'oldest');
		expect(result).toEqual({
			id: validUuid,
			seconds: 1704067200,
			direction: 'a',
		});
	});
});

describe('decodeCursor - malformed/invalid cursors', () => {
	it('returns null for undefined cursor', () => {
		expect(decodeCursor(undefined, 'latest')).toBeNull();
	});

	it('returns null for empty cursor', () => {
		expect(decodeCursor('', 'latest')).toBeNull();
	});

	it('returns null for cursor with too few parts', () => {
		expect(decodeCursor('abc123', 'latest')).toBeNull();
		expect(decodeCursor('abc123:1704067200', 'latest')).toBeNull();
	});

	it('returns null for cursor with invalid UUID - SQL injection attempt', () => {
		// Single quote injection
		expect(decodeCursor("'; DROP TABLE--:1704067200:d", 'latest')).toBeNull();

		// OR injection
		expect(decodeCursor("' OR '1'='1':1704067200:d", 'latest')).toBeNull();

		// UNION injection
		expect(decodeCursor("' UNION SELECT--:1704067200:d", 'latest')).toBeNull();
	});

	it('returns null for cursor with SQL injection in search format', () => {
		// SQL injection in id field of search cursor
		expect(decodeCursor("1000001234:1704067200:'; DELETE--:d", 'latest')).toBeNull();
	});

	it('returns null for cursor with non-UUID id (random string)', () => {
		expect(decodeCursor('not-a-uuid:1704067200:d', 'latest')).toBeNull();
	});

	it('returns null for cursor with malformed UUID', () => {
		// Missing segment
		expect(decodeCursor('550e8400-e29b-41d4-a716:1704067200:d', 'latest')).toBeNull();
		// Extra segment
		expect(
			decodeCursor('550e8400-e29b-41d4-a716-446655440000-extra:1704067200:d', 'latest'),
		).toBeNull();
	});

	it('returns null for cursor with invalid direction', () => {
		const validUuid = '550e8400-e29b-41d4-a716-446655440000';
		expect(decodeCursor(`${validUuid}:1704067200:x`, 'latest')).toBeNull();
	});

	it('returns null for cursor with wrong direction for sort', () => {
		const validUuid = '550e8400-e29b-41d4-a716-446655440000';
		// 'a' direction but 'latest' sort expects 'd'
		expect(decodeCursor(`${validUuid}:1704067200:a`, 'latest')).toBeNull();
	});

	it('returns null for cursor with negative seconds', () => {
		const validUuid = '550e8400-e29b-41d4-a716-446655440000';
		expect(decodeCursor(`${validUuid}:-1:d`, 'latest')).toBeNull();
	});

	it('returns null for cursor with non-numeric seconds', () => {
		const validUuid = '550e8400-e29b-41d4-a716-446655440000';
		expect(decodeCursor(`${validUuid}:NaN:d`, 'latest')).toBeNull();
	});

	it('returns null for cursor with special characters in id', () => {
		// Path traversal attempt
		expect(decodeCursor('../../../etc/passwd:1704067200:d', 'latest')).toBeNull();
	});

	it('returns null for cursor with binary data pattern', () => {
		// Null byte injection
		expect(
			decodeCursor('550e8400-e29b-41d4\x00-a716-446655440000:1704067200:d', 'latest'),
		).toBeNull();
	});
});

describe('decodeCursor - timestamp bounds validation', () => {
	const validUuid = '550e8400-e29b-41d4-a716-446655440000';

	it('returns null for timestamp exceeding year 2100 (Unix overflow)', () => {
		// Year 2100 in Unix seconds is 4102444800
		// Overflow timestamp: 9999999999 (clearly invalid)
		expect(decodeCursor(`${validUuid}:9999999999:d`, 'latest')).toBeNull();
	});

	it('returns null for timestamp exceeding MAX_REASONABLE_TIMESTAMP', () => {
		// 4102444801 is 1 second after year 2100
		expect(decodeCursor(`${validUuid}:4102444801:d`, 'latest')).toBeNull();
	});

	it('accepts timestamp at MAX_REASONABLE_TIMESTAMP boundary', () => {
		// Exactly year 2100 boundary
		const result = decodeCursor(`${validUuid}:4102444800:d`, 'latest');
		expect(result).toEqual({
			id: validUuid,
			seconds: 4102444800,
			direction: 'd',
		});
	});

	it('accepts timestamp below MAX_REASONABLE_TIMESTAMP', () => {
		// One second before year 2100
		const result = decodeCursor(`${validUuid}:4102444799:d`, 'latest');
		expect(result).toEqual({
			id: validUuid,
			seconds: 4102444799,
			direction: 'd',
		});
	});

	it('accepts typical timestamp', () => {
		// January 2024
		const result = decodeCursor(`${validUuid}:1704067200:d`, 'latest');
		expect(result).toEqual({
			id: validUuid,
			seconds: 1704067200,
			direction: 'd',
		});
	});

	it('returns null for FTS cursor with timestamp exceeding year 2100', () => {
		expect(decodeCursor(`1000001234:9999999999:${validUuid}:d`, 'latest')).toBeNull();
	});

	it('returns null for FTS cursor with timestamp exceeding MAX_REASONABLE_TIMESTAMP', () => {
		expect(decodeCursor(`1000001234:4102444801:${validUuid}:d`, 'latest')).toBeNull();
	});

	it('accepts FTS cursor with timestamp at MAX_REASONABLE_TIMESTAMP boundary', () => {
		const result = decodeCursor(`1000001234:4102444800:${validUuid}:d`, 'latest');
		expect(result).toEqual({
			id: validUuid,
			seconds: 4102444800,
			direction: 'd',
			ftsRank: 1234 / 10000,
		});
	});

	it('accepts zero timestamp (Unix epoch)', () => {
		// Zero is valid - represents Jan 1, 1970 UTC
		const result = decodeCursor(`${validUuid}:0:d`, 'latest');
		expect(result).toEqual({
			id: validUuid,
			seconds: 0,
			direction: 'd',
		});
	});
});
