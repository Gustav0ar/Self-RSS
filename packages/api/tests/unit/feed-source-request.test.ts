import { describe, expect, it } from 'vitest';
import {
	createSourceFetchHeaders,
	SOURCE_FETCH_USER_AGENT,
} from '../../src/services/feed-source-request.js';

describe('source fetch request headers', () => {
	it('uses a transparent Self Feed identity and supports an explicit contact hook', () => {
		expect(createSourceFetchHeaders()['User-Agent']).toBe(SOURCE_FETCH_USER_AGENT);
		expect(createSourceFetchHeaders()['User-Agent']).not.toContain('Mozilla');
		expect(
			createSourceFetchHeaders({
				userAgent: 'Self-Feed/testing',
				contact: 'mailto:operator@example.com',
			})['User-Agent'],
		).toBe('Self-Feed/testing; contact=mailto:operator@example.com');
		expect(createSourceFetchHeaders().Accept).toContain('application/feed+json');
	});
});
