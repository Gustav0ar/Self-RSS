import { describe, expect, it } from 'vitest';
import { createTokenUtils } from '../../src/utils/tokens.js';

const TEST_SECRET = 'test-access-secret-key-at-least-32-chars';
const TEST_REFRESH_SECRET = 'test-refresh-secret-key-at-least-32-chars';

describe('token utilities', () => {
	const tokenUtils = createTokenUtils(
		TEST_SECRET,
		TEST_REFRESH_SECRET,
		'15m', // access token expiry
		'7d', // refresh token expiry
	);

	describe('signAccessToken', () => {
		it('creates a valid JWT string', async () => {
			const token = await tokenUtils.signAccessToken('user-123', 'admin');
			expect(typeof token).toBe('string');
			expect(token.split('.').length).toBe(3); // JWT has 3 parts
		});

		it('includes user ID in the token payload', async () => {
			const token = await tokenUtils.signAccessToken('user-456', 'user');
			const payload = await tokenUtils.verifyAccessToken(token);
			expect(payload.sub).toBe('user-456');
		});

		it('includes role in the token payload', async () => {
			const token = await tokenUtils.signAccessToken('user-789', 'moderator');
			const payload = await tokenUtils.verifyAccessToken(token);
			expect(payload.role).toBe('moderator');
		});

		it('marks token as access type', async () => {
			const token = await tokenUtils.signAccessToken('user-1', 'admin');
			const payload = await tokenUtils.verifyAccessToken(token);
			expect(payload.type).toBe('access');
		});

		it('includes jti claim', async () => {
			const token = await tokenUtils.signAccessToken('user-1', 'admin');
			const payload = await tokenUtils.verifyAccessToken(token);
			expect(payload.jti).toBeDefined();
			expect(typeof payload.jti).toBe('string');
		});

		it('creates unique tokens for the same user', async () => {
			const token1 = await tokenUtils.signAccessToken('user-1', 'admin');
			const token2 = await tokenUtils.signAccessToken('user-1', 'admin');
			expect(token1).not.toBe(token2);
		});
	});

	describe('signRefreshToken', () => {
		it('creates a valid JWT string', async () => {
			const token = await tokenUtils.signRefreshToken('user-123', 'admin');
			expect(typeof token).toBe('string');
			expect(token.split('.').length).toBe(3);
		});

		it('includes user ID in the token payload', async () => {
			const token = await tokenUtils.signRefreshToken('user-456', 'user');
			const payload = await tokenUtils.verifyRefreshToken(token);
			expect(payload.sub).toBe('user-456');
		});

		it('includes role in the token payload', async () => {
			const token = await tokenUtils.signRefreshToken('user-789', 'admin');
			const payload = await tokenUtils.verifyRefreshToken(token);
			expect(payload.role).toBe('admin');
		});

		it('marks token as refresh type', async () => {
			const token = await tokenUtils.signRefreshToken('user-1', 'user');
			const payload = await tokenUtils.verifyRefreshToken(token);
			expect(payload.type).toBe('refresh');
		});

		it('includes jti claim', async () => {
			const token = await tokenUtils.signRefreshToken('user-1', 'admin');
			const payload = await tokenUtils.verifyRefreshToken(token);
			expect(payload.jti).toBeDefined();
		});
	});

	describe('verifyAccessToken', () => {
		it('verifies a valid access token', async () => {
			const token = await tokenUtils.signAccessToken('user-1', 'admin');
			const payload = await tokenUtils.verifyAccessToken(token);
			expect(payload.sub).toBe('user-1');
			expect(payload.role).toBe('admin');
		});

		it('rejects a refresh token when verifying as access token', async () => {
			const refreshToken = await tokenUtils.signRefreshToken('user-1', 'admin');
			await expect(tokenUtils.verifyAccessToken(refreshToken)).rejects.toThrow();
		});

		it('rejects tampered tokens', async () => {
			const token = await tokenUtils.signAccessToken('user-1', 'admin');
			const tamperedToken = token.slice(0, -5) + 'xxxxx';
			await expect(tokenUtils.verifyAccessToken(tamperedToken)).rejects.toThrow();
		});

		it('rejects tokens signed with wrong secret', async () => {
			const wrongUtils = createTokenUtils(
				'wrong-secret-key-at-least-32-characters',
				TEST_REFRESH_SECRET,
				'15m',
				'7d',
			);
			const token = await wrongUtils.signAccessToken('user-1', 'admin');
			await expect(tokenUtils.verifyAccessToken(token)).rejects.toThrow();
		});

		it('rejects completely invalid tokens', async () => {
			await expect(tokenUtils.verifyAccessToken('not.a.token')).rejects.toThrow();
		});

		it('rejects empty string tokens', async () => {
			await expect(tokenUtils.verifyAccessToken('')).rejects.toThrow();
		});

		it('rejects malformed JWTs', async () => {
			await expect(tokenUtils.verifyAccessToken('header.payload')).rejects.toThrow();
		});
	});

	describe('verifyRefreshToken', () => {
		it('verifies a valid refresh token', async () => {
			const token = await tokenUtils.signRefreshToken('user-1', 'admin');
			const payload = await tokenUtils.verifyRefreshToken(token);
			expect(payload.sub).toBe('user-1');
			expect(payload.role).toBe('admin');
		});

		it('rejects an access token when verifying as refresh token', async () => {
			const accessToken = await tokenUtils.signAccessToken('user-1', 'admin');
			await expect(tokenUtils.verifyRefreshToken(accessToken)).rejects.toThrow();
		});

		it('rejects tokens signed with wrong secret', async () => {
			const wrongUtils = createTokenUtils(
				TEST_SECRET,
				'wrong-refresh-secret-at-least-32-characters',
				'15m',
				'7d',
			);
			const token = await wrongUtils.signRefreshToken('user-1', 'admin');
			await expect(tokenUtils.verifyRefreshToken(token)).rejects.toThrow();
		});
	});

	describe('expiry parsing', () => {
		it('parses seconds correctly', () => {
			const utils = createTokenUtils(
				TEST_SECRET,
				TEST_REFRESH_SECRET,
				'30s',
				'60s',
			);
			expect(utils.accessExpiresIn).toBe(30);
			expect(utils.refreshExpiresIn).toBe(60);
		});

		it('parses minutes correctly', () => {
			const utils = createTokenUtils(
				TEST_SECRET,
				TEST_REFRESH_SECRET,
				'5m',
				'15m',
			);
			expect(utils.accessExpiresIn).toBe(300);
			expect(utils.refreshExpiresIn).toBe(900);
		});

		it('parses hours correctly', () => {
			const utils = createTokenUtils(
				TEST_SECRET,
				TEST_REFRESH_SECRET,
				'1h',
				'24h',
			);
			expect(utils.accessExpiresIn).toBe(3600);
			expect(utils.refreshExpiresIn).toBe(86400);
		});

		it('parses days correctly', () => {
			const utils = createTokenUtils(
				TEST_SECRET,
				TEST_REFRESH_SECRET,
				'7d',
				'30d',
			);
			expect(utils.accessExpiresIn).toBe(604800);
			expect(utils.refreshExpiresIn).toBe(2592000);
		});

		it('throws on invalid expiry format', () => {
			expect(() =>
				createTokenUtils(TEST_SECRET, TEST_REFRESH_SECRET, 'invalid', '7d'),
			).toThrow('Invalid expiry format: invalid');
		});

		it('throws on missing unit', () => {
			expect(() =>
				createTokenUtils(TEST_SECRET, TEST_REFRESH_SECRET, '100', '7d'),
			).toThrow('Invalid expiry format: 100');
		});
	});

	describe('token isolation', () => {
		it('access token cannot be verified with refresh secret', async () => {
			const accessToken = await tokenUtils.signAccessToken('user-1', 'admin');
			// The token was signed with accessSecret, so refresh verification should fail
			await expect(tokenUtils.verifyRefreshToken(accessToken)).rejects.toThrow();
		});

		it('refresh token cannot be verified with access secret', async () => {
			const refreshToken = await tokenUtils.signRefreshToken('user-1', 'admin');
			// The token was signed with refreshSecret, so access verification should fail
			await expect(tokenUtils.verifyAccessToken(refreshToken)).rejects.toThrow();
		});
	});
});
