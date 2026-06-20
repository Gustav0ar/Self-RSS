import { describe, expect, it, vi } from 'vitest';
import { UserRepository } from '../../src/repositories/user.repository.js';

describe('UserRepository', () => {
	describe('create', () => {
		it('creates a user and returns it', async () => {
			const mockUser = {
				id: 'user-1',
				email: 'test@example.com',
				passwordHash: 'hash123',
				role: 'user',
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const db = {
				insert: vi.fn().mockReturnValue({
					values: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([mockUser]),
					}),
				}),
			};

			const repo = new UserRepository(db as never);
			const result = await repo.create({
				email: 'test@example.com',
				passwordHash: 'hash123',
			});

			expect(result).toEqual(mockUser);
			expect(db.insert).toHaveBeenCalled();
		});

		it('throws an error when user creation fails', async () => {
			const db = {
				insert: vi.fn().mockReturnValue({
					values: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([]),
					}),
				}),
			};

			const repo = new UserRepository(db as never);
			await expect(
				repo.create({
					email: 'test@example.com',
					passwordHash: 'hash123',
				}),
			).rejects.toThrow('Failed to create user');
		});
	});

	describe('createWithPreferences', () => {
		it('creates a user with preferences in a transaction', async () => {
			const mockUser = {
				id: 'user-1',
				email: 'test@example.com',
				passwordHash: 'hash123',
				role: 'user',
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const mockTx = {
				insert: vi.fn().mockReturnValue({
					values: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([mockUser]),
					}),
				}),
			};

			const db = {
				transaction: vi.fn().mockImplementation(async (fn) => fn(mockTx)),
			};

			const repo = new UserRepository(db as never);
			const result = await repo.createWithPreferences({
				email: 'test@example.com',
				passwordHash: 'hash123',
			});

			expect(result).toEqual(mockUser);
			expect(db.transaction).toHaveBeenCalled();
		});

		it('throws an error when user creation fails in transaction', async () => {
			const mockTx = {
				insert: vi.fn().mockReturnValue({
					values: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([]),
					}),
				}),
			};

			const db = {
				transaction: vi.fn().mockImplementation(async (fn) => fn(mockTx)),
			};

			const repo = new UserRepository(db as never);
			await expect(
				repo.createWithPreferences({
					email: 'test@example.com',
					passwordHash: 'hash123',
				}),
			).rejects.toThrow('Failed to create user');
		});
	});

	describe('registerUser', () => {
		it('registers a user and returns it with bootstrap flag', async () => {
			const mockUser = {
				id: 'user-1',
				email: 'test@example.com',
				passwordHash: 'hash123',
				role: 'admin',
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const mockTx = {
				query: {
					users: {
						findFirst: vi.fn().mockResolvedValue(null),
					},
				},
				select: vi.fn().mockReturnValue({
					from: vi.fn().mockResolvedValue([{ count: 0 }]),
				}),
				insert: vi.fn().mockReturnValue({
					values: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([mockUser]),
					}),
				}),
			};

			const db = {
				transaction: vi.fn().mockImplementation(async (fn) => fn(mockTx)),
			};

			const repo = new UserRepository(db as never);
			const result = await repo.registerUser({
				email: 'test@example.com',
				passwordHash: 'hash123',
				registrationLocked: false,
			});

			expect(result).toEqual({ user: mockUser, isBootstrapAdmin: true });
		});

		it('throws an error when user creation fails during registration', async () => {
			const mockTx = {
				query: {
					users: {
						findFirst: vi.fn().mockResolvedValue(null),
					},
				},
				select: vi.fn().mockReturnValue({
					from: vi.fn().mockResolvedValue([{ count: 0 }]),
				}),
				insert: vi.fn().mockReturnValue({
					values: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([]),
					}),
				}),
			};

			const db = {
				transaction: vi.fn().mockImplementation(async (fn) => fn(mockTx)),
			};

			const repo = new UserRepository(db as never);
			await expect(
				repo.registerUser({
					email: 'test@example.com',
					passwordHash: 'hash123',
					registrationLocked: false,
				}),
			).rejects.toThrow('Failed to create user');
		});
	});

	describe('createPreferences', () => {
		it('creates preferences for a user', async () => {
			const mockPrefs = {
				id: 'prefs-1',
				userId: 'user-1',
				theme: 'system',
				fontFamily: 'Inter',
				textSize: 16,
				density: 'comfortable',
				defaultSort: 'latest',
				hideRead: false,
				keyboardShortcutsEnabled: true,
				autoMarkReadMode: 'on_navigate',
				accentColor: 'indigo',
				updatedAt: new Date(),
			};

			const db = {
				insert: vi.fn().mockReturnValue({
					values: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([mockPrefs]),
					}),
				}),
			};

			const repo = new UserRepository(db as never);
			const result = await repo.createPreferences('user-1');

			expect(result).toEqual(mockPrefs);
		});

		it('throws an error when preferences creation fails', async () => {
			const db = {
				insert: vi.fn().mockReturnValue({
					values: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([]),
					}),
				}),
			};

			const repo = new UserRepository(db as never);
			await expect(repo.createPreferences('user-1')).rejects.toThrow(
				'Failed to create user preferences',
			);
		});
	});
});
