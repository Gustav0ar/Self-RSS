import { createHash } from 'node:crypto';
import { getEnv } from '../packages/api/src/config/index.js';
import { closeDb, getDb } from '../packages/api/src/db/client.js';
import { ArticleRepository } from '../packages/api/src/repositories/article.repository.js';
import { CategoryRepository } from '../packages/api/src/repositories/category.repository.js';
import { FeedRepository } from '../packages/api/src/repositories/feed.repository.js';
import { PreferencesRepository } from '../packages/api/src/repositories/preferences.repository.js';
import { UserRepository } from '../packages/api/src/repositories/user.repository.js';

const env = getEnv();
const db = getDb(env.DATABASE_URL);
const userRepo = new UserRepository(db);
const categoryRepo = new CategoryRepository(db);
const feedRepo = new FeedRepository(db);
const articleRepo = new ArticleRepository(db);
const prefsRepo = new PreferencesRepository(db);

async function ensureUser(email: string, password: string, role: 'admin' | 'user') {
	const existing = await userRepo.findByEmail(email);
	if (existing) return existing;
	const passwordHash = await Bun.password.hash(password, { algorithm: 'argon2id' });
	const user = await userRepo.create({ email, passwordHash, role });
	await userRepo.createPreferences(user.id);
	return user;
}

async function seed() {
	await ensureUser('admin@example.com', 'password123', 'admin');
	const reader = await ensureUser('reader@example.com', 'password123', 'user');

	await prefsRepo.upsert(reader.id, {
		theme: 'system',
		fontFamily: 'Inter',
		textSize: 16,
		density: 'comfortable',
		defaultSort: 'latest',
		hideRead: false,
		keyboardShortcutsEnabled: true,
		autoMarkReadMode: 'on_open',
	});

	const existingCategories = await categoryRepo.findAllByUser(reader.id);
	if (existingCategories.length > 0) {
		return;
	}

	const tech = await categoryRepo.create({
		userId: reader.id,
		name: 'Tech',
		slug: 'tech',
		sortOrder: 0,
	});
	const news = await categoryRepo.create({
		userId: reader.id,
		name: 'News',
		slug: 'news',
		sortOrder: 1,
	});

	const bunFeed = await feedRepo.create({
		userId: reader.id,
		categoryId: tech.id,
		title: 'Bun Blog',
		feedUrl: 'https://example.com/bun.xml',
		siteUrl: 'https://example.com/bun',
		faviconUrl: 'https://example.com/favicon.ico',
		description: 'Bun updates',
	});
	const worldFeed = await feedRepo.create({
		userId: reader.id,
		categoryId: news.id,
		title: 'World News',
		feedUrl: 'https://example.com/world.xml',
		siteUrl: 'https://example.com/world',
		faviconUrl: 'https://example.com/world.ico',
		description: 'World news updates',
	});

	const insertedArticles = await articleRepo.insertMany([
		{
			feedId: bunFeed.id,
			guid: 'alpha-launch',
			canonicalUrl: 'https://example.com/bun/alpha-launch',
			title: 'Alpha Launch',
			author: 'Bun Team',
			excerpt: 'Alpha launch excerpt',
			contentHtml: '<p>Alpha launch ships fast JavaScript tooling.</p>',
			contentText: 'Alpha launch ships fast JavaScript tooling.',
			heroImageUrl: 'https://example.com/images/alpha.png',
			publishedAt: new Date('2025-01-10T10:00:00Z'),
			hash: createHash('sha256').update('alpha-launch').digest('hex'),
		},
		{
			feedId: bunFeed.id,
			guid: 'beta-update',
			canonicalUrl: 'https://example.com/bun/beta-update',
			title: 'Beta Update',
			author: 'Bun Team',
			excerpt: 'Beta update excerpt',
			contentHtml: '<p>Beta update improves package installs.</p>',
			contentText: 'Beta update improves package installs.',
			heroImageUrl: null,
			publishedAt: new Date('2025-01-09T10:00:00Z'),
			hash: createHash('sha256').update('beta-update').digest('hex'),
		},
		{
			feedId: worldFeed.id,
			guid: 'gamma-world',
			canonicalUrl: 'https://example.com/world/gamma',
			title: 'Gamma World',
			author: 'Reporter',
			excerpt: 'Gamma world excerpt',
			contentHtml: '<p>Gamma world coverage and analysis.</p>',
			contentText: 'Gamma world coverage and analysis.',
			heroImageUrl: null,
			publishedAt: new Date('2025-01-08T10:00:00Z'),
			hash: createHash('sha256').update('gamma-world').digest('hex'),
		},
	]);

	const betaArticle = insertedArticles.find((article) => article.guid === 'beta-update');
	const alphaArticle = insertedArticles.find((article) => article.guid === 'alpha-launch');
	if (alphaArticle) {
		await articleRepo.insertMedia([
			{
				articleId: alphaArticle.id,
				type: 'video',
				provider: 'videopress',
				url: 'https://videos.files.wordpress.com/e2e/alpha-navigation.mp4',
				embedUrl: 'https://videos.files.wordpress.com/e2e/alpha-navigation.mp4',
				width: 1280,
				height: 720,
				position: 0,
			},
		]);
	}
	if (betaArticle) {
		await articleRepo.markRead(reader.id, betaArticle.id, 'manual');
	}
}

try {
	await seed();
} finally {
	await closeDb();
}
