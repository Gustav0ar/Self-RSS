import { Database } from 'bun:sqlite';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import Redis from 'ioredis';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations } from '../../src/db/migrations.js';
import { CacheKeys } from '../../src/db/redis.js';
import * as schema from '../../src/db/schema.js';
import { AuthSessionRepository } from '../../src/repositories/auth-session.repository.js';
import { AppSettingsRepository } from '../../src/repositories/settings.repository.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { AuthService } from '../../src/services/auth.service.js';
import { hashPassword } from '../../src/utils/password.js';
import { createTokenUtils } from '../../src/utils/tokens.js';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error('Integration tests require REDIS_URL');
const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
const databases: Database[] = [];
const sessionKeys = new Set<string>();

afterEach(async () => {
	vi.restoreAllMocks();
	for (const sqlite of databases.splice(0)) {
		for (const { id } of sqlite.query<{ id: string }, []>('SELECT id FROM auth_sessions').all()) {
			sessionKeys.add(CacheKeys.authSessionActive(id));
			sessionKeys.add(CacheKeys.authSessionRevoked(id));
		}
		sqlite.close();
	}
	if (sessionKeys.size > 0) await redis.del(...sessionKeys);
	sessionKeys.clear();
});

afterAll(() => redis.quit());

async function setup() {
	const sqlite = new Database(':memory:');
	databases.push(sqlite);
	const db = drizzle(sqlite, { schema });
	applyMigrations(db, { migrationsFolder: resolve(import.meta.dir, '../../drizzle') });
	const users = new UserRepository(db);
	const sessions = new AuthSessionRepository(db);
	const tokens = createTokenUtils(crypto.randomUUID(), crypto.randomUUID(), '15m', '7d');
	const passwordHash = await hashPassword('original-password');
	const actor = await users.createWithPreferences({
		email: 'actor@example.com',
		passwordHash,
		role: 'admin',
	});
	const target = await users.createWithPreferences({
		email: 'target@example.com',
		passwordHash,
		role: 'admin',
	});
	const auth = new AuthService(users, sessions, new AppSettingsRepository(db), tokens, redis);
	return { sqlite, users, sessions, tokens, actor, target, auth };
}

type Setup = Awaited<ReturnType<typeof setup>>;
const securityChanges = [
	{
		name: 'password reset',
		apply: ({ auth, target }: Setup) => auth.adminResetPassword(target.id, 'replacement-password'),
	},
	{
		name: 'deactivation',
		apply: ({ auth, actor, target }: Setup) =>
			auth.adminUpdateUser(actor.id, target.id, { isActive: false }),
	},
	{
		name: 'demotion',
		apply: ({ auth, actor, target }: Setup) =>
			auth.adminUpdateUser(actor.id, target.id, { role: 'user' }),
	},
];

describe('account changes and concurrent session creation', () => {
	it.each(securityChanges)('rejects credentials verified before $name', async ({ apply }) => {
		const context = await setup();
		const reached = Promise.withResolvers<void>();
		const resume = Promise.withResolvers<void>();
		const create = context.sessions.create.bind(context.sessions);
		vi.spyOn(context.sessions, 'create').mockImplementationOnce(async (...args) => {
			reached.resolve();
			await resume.promise;
			return create(...args);
		});
		const login = context.auth.login(context.target.email, 'original-password').then(
			() => null,
			(error: unknown) => error,
		);
		await reached.promise;
		try {
			await apply(context);
		} finally {
			resume.resolve();
		}
		expect(await login).toMatchObject({ statusCode: 401 });
		expect(await context.sessions.listActiveByUserId(context.target.id)).toHaveLength(0);
	});

	it.each(securityChanges)('cannot repopulate session cache after $name', async ({ apply }) => {
		const context = await setup();
		const reached = Promise.withResolvers<void>();
		const resume = Promise.withResolvers<void>();
		const create = context.sessions.create.bind(context.sessions);
		vi.spyOn(context.sessions, 'create').mockImplementationOnce(async (...args) => {
			const session = await create(...args);
			reached.resolve();
			await resume.promise;
			return session;
		});
		const login = context.auth.login(context.target.email, 'original-password');
		await reached.promise;
		try {
			await apply(context);
		} finally {
			resume.resolve();
		}
		const result = await login;
		const payload = await context.tokens.verifyAccessToken(result.tokens.accessToken);
		if (!payload.sid) throw new Error('Login did not issue a session-bound access token');
		expect(await context.auth.isAccessSessionActive(context.target.id, payload.sid)).toBe(false);
		expect(await redis.get(CacheKeys.authSessionActive(payload.sid))).toBeNull();
		expect(await context.sessions.listActiveByUserId(context.target.id)).toHaveLength(0);
	});

	it.each(securityChanges)('revokes sessions created during $name cache invalidation', async ({
		apply,
	}) => {
		const context = await setup();
		const reached = Promise.withResolvers<void>();
		const resume = Promise.withResolvers<void>();
		const list = context.sessions.listActiveByUserId.bind(context.sessions);
		vi.spyOn(context.sessions, 'listActiveByUserId').mockImplementationOnce(async (...args) => {
			const initialSessions = await list(...args);
			reached.resolve();
			await resume.promise;
			return initialSessions;
		});
		const change = apply(context);
		await reached.promise;
		const result = await context.auth.login(context.target.email, 'original-password');
		const payload = await context.tokens.verifyAccessToken(result.tokens.accessToken);
		expect(await context.auth.isAccessSessionActive(context.target.id, payload.sid)).toBe(true);
		resume.resolve();
		await change;
		expect(await context.auth.isAccessSessionActive(context.target.id, payload.sid)).toBe(false);
		expect(await context.sessions.listActiveByUserId(context.target.id)).toHaveLength(0);
	});

	it('rolls back credential changes if the atomic session revocation fails', async () => {
		const context = await setup();
		await context.auth.login(context.target.email, 'original-password');
		context.sqlite.exec(`
			CREATE TRIGGER reject_session_revocation BEFORE UPDATE OF revoked_at ON auth_sessions
			BEGIN SELECT RAISE(ABORT, 'session revocation rejected'); END;
		`);
		await expect(
			context.users.updatePasswordHash(context.target.id, 'replacement-hash'),
		).rejects.toThrow('session revocation rejected');
		expect((await context.users.findById(context.target.id))?.passwordHash).toBe(
			context.target.passwordHash,
		);
		expect(await context.sessions.listActiveByUserId(context.target.id)).toHaveLength(1);
	});
});
