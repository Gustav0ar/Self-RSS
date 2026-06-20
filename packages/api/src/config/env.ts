import { z } from 'zod';

function looksLikePlaceholderSecret(value: string) {
	return /change-me|replace-me|example-secret|dev-only/i.test(value);
}

const booleanCoercible = z.preprocess((val) => {
	if (typeof val === 'string') {
		if (val.toLowerCase() === 'true' || val === '1') return true;
		if (val.toLowerCase() === 'false' || val === '0') return false;
	}
	return val;
}, z.coerce.boolean());

const rawEnvSchema = z
	.object({
		NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
		DATABASE_URL: z.string().default('data/rss.db'),
		REDIS_URL: z.string().url(),
		REDIS_PASSWORD: z.string().optional(),
		JWT_SECRET: z.string().min(32),
		JWT_REFRESH_SECRET: z.string().min(32),
		JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
		JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
		API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
		API_HOST: z.string().default('0.0.0.0'),
		API_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(600).default(120),
		CORS_ALLOWED_ORIGINS: z.string().default(''),
		TRUST_PROXY: booleanCoercible.default(false),
		TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
		ADMIN_EMAIL: z.string().email().optional(),
		ADMIN_PASSWORD: z.string().min(8).optional(),
		FEED_SYNC_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(5),
		FEED_SYNC_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
		FEED_MAX_CONTENT_LENGTH: z.coerce.number().int().min(1024).default(5242880),
		FEED_ALLOW_PRIVATE_HOSTS: booleanCoercible.default(false),
		ALLOW_REGISTRATION: booleanCoercible.optional(),
		RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).default(30),
		RATE_LIMIT_FEED_CREATE_MAX: z.coerce.number().int().min(1).default(100),
		RATE_LIMIT_SEARCH_MAX: z.coerce.number().int().min(1).default(100),
		REQUIRE_WORKER_HEARTBEAT: booleanCoercible.optional(),
		CACHE_WARMER_INTERVAL_MS: z.coerce.number().int().min(1000).max(3600000).default(60000),
		CACHE_WARMER_RECENT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(10),
		CACHE_WARMER_RECENT_USERS_LIMIT: z.coerce.number().int().min(1).max(1000).default(25),
		CACHE_WARMER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(5),
		CACHE_WARMER_IDLE_USERS_ENABLED: booleanCoercible.default(false),
		CACHE_WARMER_IDLE_USERS_LIMIT: z.coerce.number().int().min(1).max(1000).default(25),
		RETENTION_DELETION_ENABLED: booleanCoercible.default(false),
		RETENTION_DELETION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
		RETENTION_DRY_RUN: booleanCoercible.default(true),
	})
	.superRefine((env, ctx) => {
		if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
			ctx.addIssue({
				code: 'custom',
				path: ['JWT_REFRESH_SECRET'],
				message: 'JWT refresh secret must differ from JWT secret',
			});
		}

		if (env.NODE_ENV !== 'production') {
			return;
		}

		if (looksLikePlaceholderSecret(env.JWT_SECRET)) {
			ctx.addIssue({
				code: 'custom',
				path: ['JWT_SECRET'],
				message: 'JWT secret must not use a placeholder value in production',
			});
		}

		if (looksLikePlaceholderSecret(env.JWT_REFRESH_SECRET)) {
			ctx.addIssue({
				code: 'custom',
				path: ['JWT_REFRESH_SECRET'],
				message: 'JWT refresh secret must not use a placeholder value in production',
			});
		}

		if (env.FEED_ALLOW_PRIVATE_HOSTS) {
			ctx.addIssue({
				code: 'custom',
				path: ['FEED_ALLOW_PRIVATE_HOSTS'],
				message: 'Private feed hosts must stay disabled in production',
			});
		}

		if (env.ADMIN_EMAIL === 'admin@example.com') {
			ctx.addIssue({
				code: 'custom',
				path: ['ADMIN_EMAIL'],
				message: 'Admin email must not use the default example value in production',
			});
		}

		if (env.ADMIN_PASSWORD && looksLikePlaceholderSecret(env.ADMIN_PASSWORD)) {
			ctx.addIssue({
				code: 'custom',
				path: ['ADMIN_PASSWORD'],
				message: 'Admin password must not use a placeholder value in production',
			});
		}
	});

const envSchema = rawEnvSchema.transform((env) => ({
	...env,
	ALLOW_REGISTRATION: env.ALLOW_REGISTRATION ?? env.NODE_ENV !== 'production',
	REQUIRE_WORKER_HEARTBEAT: env.REQUIRE_WORKER_HEARTBEAT ?? env.NODE_ENV === 'production',
}));

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
	if (cachedEnv) return cachedEnv;
	const result = envSchema.safeParse(process.env);
	if (!result.success) {
		const formatted = result.error.issues
			.map((i) => `  ${i.path.join('.')}: ${i.message}`)
			.join('\n');
		throw new Error(`Invalid environment variables:\n${formatted}`);
	}
	cachedEnv = result.data;
	return cachedEnv;
}

export function clearEnvCache(): void {
	cachedEnv = null;
}
