import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

interface FileLineBudget {
	maxLines: number;
	reason: string;
}

interface ForbiddenPattern {
	pattern: RegExp;
	reason: string;
	allowedPaths?: Set<string>;
}

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE_ROOTS = ['packages/api/src', 'packages/web/src', 'packages/shared/src', 'scripts'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.sh']);
const DEFAULT_MAX_LINES = 650;
const FILE_LINE_BUDGETS: Record<string, FileLineBudget> = {
	'packages/api/src/services/feed-sync.service.ts': {
		maxLines: 1100,
		reason:
			'Legacy feed sync orchestration; split parser, persistence, and scheduling helpers before expanding.',
	},
	'packages/api/src/utils/sanitizer.ts': {
		maxLines: 850,
		reason:
			'HTML sanitization rules are centralized; extract policy tables before adding new behavior.',
	},
	'packages/api/src/repositories/article.repository.ts': {
		maxLines: 650,
		reason:
			'Article persistence should stay focused; keep cursor, search mapping, and scope SQL in article-query helpers.',
	},
	'packages/api/src/repositories/article-query.helpers.ts': {
		maxLines: 180,
		reason:
			'Article query helpers should remain focused on search row mapping, FTS query shaping, and scope SQL.',
	},
	'packages/api/src/utils/article-cursor.ts': {
		maxLines: 140,
		reason:
			'Article cursor encoding and decoding must stay centralized and easy to audit for pagination safety.',
	},
	'packages/api/src/openapi/spec.ts': {
		maxLines: 830,
		reason:
			'OpenAPI spec is declarative; prefer domain-specific spec fragments for new large endpoint groups.',
	},
	'packages/api/src/services/article-cache.service.ts': {
		maxLines: 600,
		reason:
			'Article cache orchestration should stay focused; keep cached DTOs and row mapping in article-cache.model.ts.',
	},
	'packages/api/src/services/article-cache.model.ts': {
		maxLines: 120,
		reason:
			'Article cache model helpers should stay limited to DTOs, cache limit policy, and row mapping.',
	},
	'packages/web/src/hooks/queries/cache-utils.ts': {
		maxLines: 120,
		reason:
			'Cache utils should only orchestrate read-state sync and re-export domain-specific cache helpers.',
	},
	'packages/web/src/hooks/queries/cache-query-helpers.ts': {
		maxLines: 90,
		reason: 'Query key and URL search param helpers should stay small and framework-agnostic.',
	},
	'packages/web/src/hooks/queries/article-cache-updates.ts': {
		maxLines: 230,
		reason:
			'Article cache mutation helpers should stay focused on article detail/list/search read-state updates.',
	},
	'packages/web/src/hooks/queries/unread-count-cache.ts': {
		maxLines: 300,
		reason:
			'Unread count cache helpers should stay focused on feed, category tree, and stats count updates.',
	},
	'packages/web/src/components/articles/feed-view.tsx': {
		maxLines: 430,
		reason:
			'Feed view should orchestrate data fetching and rendering; keep article-list model logic and retained-read behavior in domain helpers.',
	},
	'packages/web/src/components/articles/feed-view-model.ts': {
		maxLines: 180,
		reason:
			'Feed view model helpers should remain pure transformations for list metadata, empty states, and article selection.',
	},
	'packages/web/src/components/articles/use-retained-read-articles.ts': {
		maxLines: 100,
		reason:
			'Retained-read article state should stay limited to unread-filter retention and reset behavior.',
	},
	'packages/web/src/components/articles/reader-pane.tsx': {
		maxLines: 500,
		reason:
			'Reader pane should orchestrate state; keep effects and media rendering in reader-domain modules.',
	},
	'packages/web/src/components/layout/sidebar.tsx': {
		maxLines: 380,
		reason:
			'Sidebar should orchestrate dialogs and state; keep tree, body, storage, and reorder logic split out.',
	},
};

const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
	{
		pattern: /\bfunction\s+decodeCursor\s*\(/,
		allowedPaths: new Set(['packages/api/src/utils/article-cursor.ts']),
		reason:
			'Do not reimplement article cursor decoding. Import decodeArticleCursor from packages/api/src/utils/article-cursor.ts.',
	},
];

const IGNORED_SEGMENTS = new Set(['node_modules', 'dist', 'coverage', '.turbo', '.vite']);

function walk(dir: string): string[] {
	const entries = readdirSync(dir);
	const files: string[] = [];

	for (const entry of entries) {
		if (IGNORED_SEGMENTS.has(entry)) continue;
		const path = resolve(dir, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) {
			files.push(...walk(path));
		} else if (SOURCE_EXTENSIONS.has(getExtension(entry))) {
			files.push(path);
		}
	}

	return files;
}

function getExtension(fileName: string): string {
	const dotIndex = fileName.lastIndexOf('.');
	return dotIndex >= 0 ? fileName.slice(dotIndex) : '';
}

function lineNumberForIndex(content: string, index: number): number {
	return content.slice(0, index).split(/\r?\n/).length;
}

const failures: string[] = [];

for (const sourceRoot of SOURCE_ROOTS) {
	const absoluteRoot = resolve(ROOT, sourceRoot);
	for (const file of walk(absoluteRoot)) {
		const relativePath = relative(ROOT, file);
		const content = readFileSync(file, 'utf8');
		const lines = content.length === 0 ? 0 : content.split(/\r?\n/).length;
		const budget = FILE_LINE_BUDGETS[relativePath];
		const maxLines = budget?.maxLines ?? DEFAULT_MAX_LINES;

		if (lines > maxLines) {
			failures.push(
				budget
					? `${relativePath} has ${lines} lines, over its ${maxLines}-line allowlist budget. ${budget.reason}`
					: `${relativePath} has ${lines} lines, over the ${DEFAULT_MAX_LINES}-line source budget. Split by domain or add a documented allowlist entry with a bounded maxLines value.`,
			);
		}

		for (const forbidden of FORBIDDEN_PATTERNS) {
			if (forbidden.allowedPaths?.has(relativePath)) continue;
			const match = forbidden.pattern.exec(content);
			if (match?.index != null) {
				failures.push(
					`${relativePath}:${lineNumberForIndex(content, match.index)} matches a forbidden architecture pattern. ${forbidden.reason}`,
				);
			}
		}
	}
}

if (failures.length > 0) {
	console.error('Architecture guard failed:');
	for (const failure of failures) {
		console.error(`- ${failure}`);
	}
	process.exit(1);
}

console.log('Architecture guard passed.');
