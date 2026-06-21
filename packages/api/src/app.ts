import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { AppDeps } from './config/deps.js';
import {
	createAuthMiddleware,
	errorHandler,
	httpMetricsMiddleware,
	requestIdMiddleware,
	requestLogger,
	requireAdmin,
	securityHeaders,
} from './middleware/index.js';
import { createAdminRoutes } from './routes/admin.js';
import { createArticleRoutes, createSearchRoutes } from './routes/articles.js';
import { createAuthRoutes } from './routes/auth.js';
import { createCategoryRoutes } from './routes/categories.js';
import { createEventRoutes } from './routes/events.js';
import { createFeedRoutes } from './routes/feeds.js';
import { createHealthRoutes, createMetricsRoutes } from './routes/index.js';
import { createPreferencesRoutes } from './routes/preferences.js';
import { createStatsRoutes } from './routes/stats.js';
import type { TokenUtils } from './utils/tokens.js';

interface AppOptions {
	requireWorkerHeartbeat?: boolean;
}

function getAllowedOrigins() {
	const configured = (process.env.CORS_ALLOWED_ORIGINS ?? '')
		.split(',')
		.map((origin) => origin.trim())
		.filter(Boolean);
	return new Set(configured);
}

export function createApp(deps?: AppDeps, tokenUtils?: TokenUtils, options: AppOptions = {}) {
	const app = new Hono();
	const allowedOrigins = getAllowedOrigins();

	// Global middleware
	app.use('*', requestIdMiddleware);
	app.use('*', requestLogger);
	app.use('*', httpMetricsMiddleware(deps?.services.metrics));
	app.use('*', securityHeaders);
	app.use(
		'*',
		bodyLimit({
			maxSize: 6 * 1024 * 1024, // 6MB
			onError: (c) => {
				return c.json(
					{
						error: {
							code: 'PAYLOAD_TOO_LARGE',
							message: 'Payload too large. Maximum allowed size is 6MB.',
						},
					},
					413,
				);
			},
		}),
	);
	app.use(
		'*',
		cors({
			origin: (origin) => {
				if (!origin) {
					return undefined;
				}
				return allowedOrigins.has(origin) ? origin : undefined;
			},
			allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
			allowHeaders: [
				'Content-Type',
				'Authorization',
				'X-Self-Feed-Client-Id',
				'X-Self-Feed-Device-Name',
			],
			exposeHeaders: ['X-Request-Id'],
			maxAge: 86400,
			credentials: true,
		}),
	);

	// Health routes (no /api/v1 prefix)
	app.route(
		'/',
		createHealthRoutes(deps?.db, deps?.redis, {
			requireWorkerHeartbeat: options.requireWorkerHeartbeat,
		}),
	);

	// API v1 routes (only mounted when deps are available)
	if (deps && tokenUtils) {
		const v1 = new Hono();
		const authMiddleware = createAuthMiddleware(tokenUtils, deps.services.auth);

		v1.route('/auth', createAuthRoutes(deps.services.auth, authMiddleware, deps.rateLimiter));

		// Protected routes
		v1.use('/categories/*', authMiddleware);
		v1.route('/categories', createCategoryRoutes(deps.services.category, deps.rateLimiter));
		v1.use('/feeds/*', authMiddleware);
		v1.route(
			'/feeds',
			createFeedRoutes(
				deps.services.feed,
				deps.services.feedSync,
				deps.services.opmlExport,
				deps.services.opmlImport,
				deps.rateLimiter,
			),
		);

		v1.use('/articles/*', authMiddleware);
		v1.route('/articles', createArticleRoutes(deps.services.article, deps.rateLimiter));
		v1.use('/search/*', authMiddleware);
		v1.route('/search', createSearchRoutes(deps.services.article, deps.rateLimiter));

		v1.use('/preferences/*', authMiddleware);
		v1.route('/preferences', createPreferencesRoutes(deps.services.preferences, deps.rateLimiter));
		v1.use('/stats/*', authMiddleware);
		v1.route('/stats', createStatsRoutes(deps.services.stats, deps.rateLimiter));

		v1.use('/events/*', authMiddleware);
		v1.route('/events', createEventRoutes(deps.services.realtime));

		v1.use('/admin/*', authMiddleware, requireAdmin);
		v1.route(
			'/admin',
			createAdminRoutes(
				deps.services.auth,
				deps.repos.settings,
				deps.repos.auditLog,
				deps.rateLimiter,
			),
		);

		// Metrics endpoint (requires authentication and admin role)
		v1.use('/metrics/*', authMiddleware, requireAdmin);
		v1.route(
			'/metrics',
			createMetricsRoutes({
				db: deps.db,
				metricsService: deps.services.metrics,
				redis: deps.redis,
			}),
		);

		app.route('/api/v1', v1);
	}

	// Error handler
	app.onError(errorHandler);

	// 404 fallback
	app.notFound((c) => {
		return c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404);
	});

	return app;
}
