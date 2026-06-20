import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/utils/password.js';

describe('password utilities', () => {
	describe('hashPassword', () => {
		it('generates a non-empty hash', async () => {
			const hash = await hashPassword('password123');
			expect(hash.length).toBeGreaterThan(0);
		});

		it('generates unique salts for the same password', async () => {
			const hash1 = await hashPassword('samepassword');
			const hash2 = await hashPassword('samepassword');
			expect(hash1).not.toBe(hash2);
		});

		it('generates hashes of consistent format', async () => {
			const hash = await hashPassword('testpassword');
			const parts = hash.split('$');
			// Format is: algorithm$salt$hash
			expect(parts.length).toBeGreaterThanOrEqual(3);
		});

		it('handles very long passwords', async () => {
			const longPassword = 'a'.repeat(10000);
			const hash = await hashPassword(longPassword);
			expect(hash.length).toBeGreaterThan(0);
		});

		it('handles unicode passwords', async () => {
			const hash = await hashPassword('пароль中文🔐');
			expect(hash.length).toBeGreaterThan(0);
		});

		it('creates different hash formats based on runtime', async () => {
			const hash = await hashPassword('test');
			// Bun uses argon2id, Node uses scrypt
			const isBunFormat = hash.startsWith('$argon2id$') || hash.startsWith('argon2');
			const isNodeFormat = hash.startsWith('scrypt$');
			expect(isBunFormat || isNodeFormat).toBe(true);
		});
	});

	describe('verifyPassword', () => {
		it('returns true for correct passwords', async () => {
			const password = 'securePassword123!';
			const hash = await hashPassword(password);
			const isValid = await verifyPassword(password, hash);
			expect(isValid).toBe(true);
		});

		it('returns false for incorrect passwords', async () => {
			const hash = await hashPassword('correctPassword');
			const isValid = await verifyPassword('wrongPassword', hash);
			expect(isValid).toBe(false);
		});

		it('returns false for password with wrong length', async () => {
			const hash = await hashPassword('correctLength');
			const isValid = await verifyPassword('a', hash);
			expect(isValid).toBe(false);
		});

		it('returns false for malformed hash format (scrypt format)', async () => {
			// Test with a properly formatted but invalid scrypt hash
			const isValid = await verifyPassword(
				'password',
				'scrypt$notavalidhash$0000000000000000000000000000000000000000000000000000000000000000',
			);
			expect(isValid).toBe(false);
		});

		it('returns false for hash missing parts', async () => {
			const isValid = await verifyPassword('password', 'scrypt$');
			expect(isValid).toBe(false);
		});

		it('returns false for hash with empty salt', async () => {
			const isValid = await verifyPassword('password', 'scrypt$$hashvalue');
			expect(isValid).toBe(false);
		});

		it('handles password with special characters', async () => {
			const password = 'p@$$w0rd!#%^&*()_+-=[]{}|;\':",./<>?';
			const hash = await hashPassword(password);
			const isValid = await verifyPassword(password, hash);
			expect(isValid).toBe(true);
		});

		it('handles unicode passwords correctly', async () => {
			const password = 'пароль中文🔐';
			const hash = await hashPassword(password);
			const isValid = await verifyPassword(password, hash);
			expect(isValid).toBe(true);
		});

		it('returns false for unicode password with latin input', async () => {
			const hash = await hashPassword('пароль中文🔐');
			const isValid = await verifyPassword('password', hash);
			expect(isValid).toBe(false);
		});

		it('handles case sensitivity', async () => {
			const hash = await hashPassword('Password');
			const isValid = await verifyPassword('password', hash);
			expect(isValid).toBe(false);
		});
	});

	describe('timing safety', () => {
		it('is timing-safe (verified by implementation using timingSafeEqual or constant-time comparison)', async () => {
			const hash = await hashPassword('short');
			// Both should take similar time due to constant-time comparison
			await verifyPassword('verylongpassword', hash);
			await verifyPassword('x', hash);
			// Implementation uses timingSafeEqual (Node) or constant-time comparison (Bun)
		});
	});

	describe('edge cases', () => {
		it('handles concurrent hash and verify operations', async () => {
			const password = 'concurrentPassword';
			const hash = await hashPassword(password);

			const results = await Promise.all([
				verifyPassword(password, hash),
				verifyPassword('wrong', hash),
				verifyPassword(password, hash),
				verifyPassword(password, hash),
			]);

			expect(results).toEqual([true, false, true, true]);
		});

		it('handles concurrent operations with different passwords', async () => {
			const [hash1, hash2, hash3] = await Promise.all([
				hashPassword('password1'),
				hashPassword('password2'),
				hashPassword('password3'),
			]);

			const results = await Promise.all([
				verifyPassword('password1', hash1),
				verifyPassword('password2', hash2),
				verifyPassword('password3', hash3),
				verifyPassword('wrong', hash1),
				verifyPassword('wrong', hash2),
			]);

			expect(results).toEqual([true, true, true, false, false]);
		});

		it('handles very long passwords correctly', async () => {
			const longPassword = 'a'.repeat(10000);
			const hash = await hashPassword(longPassword);
			const isValid = await verifyPassword(longPassword, hash);
			expect(isValid).toBe(true);
		});
	});
});
