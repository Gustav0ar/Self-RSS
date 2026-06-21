import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

interface LargeFileBudget {
	maxLines: number;
	reason: string;
}

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE_ROOTS = ['packages/api/src', 'packages/web/src', 'packages/shared/src', 'scripts'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.sh']);
const DEFAULT_MAX_LINES = 650;
const LARGE_FILE_BUDGETS: Record<string, LargeFileBudget> = {
	'packages/api/src/services/feed-sync.service.ts': {
		maxLines: 1150,
		reason:
			'Legacy feed sync orchestration; split parser, persistence, and scheduling helpers before expanding.',
	},
	'packages/api/src/utils/sanitizer.ts': {
		maxLines: 850,
		reason:
			'HTML sanitization rules are centralized; extract policy tables before adding new behavior.',
	},
	'packages/api/src/repositories/article.repository.ts': {
		maxLines: 850,
		reason: 'Article query surface is broad; extract query builders before adding new read paths.',
	},
	'packages/api/src/openapi/spec.ts': {
		maxLines: 830,
		reason:
			'OpenAPI spec is declarative; prefer domain-specific spec fragments for new large endpoint groups.',
	},
	'packages/api/src/services/article-cache.service.ts': {
		maxLines: 700,
		reason:
			'Cache key and cursor behavior is coupled; extract policies before adding new cache modes.',
	},
};

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

function lineCount(path: string): number {
	const content = readFileSync(path, 'utf8');
	if (content.length === 0) return 0;
	return content.split(/\r?\n/).length;
}

const failures: string[] = [];

for (const sourceRoot of SOURCE_ROOTS) {
	const absoluteRoot = resolve(ROOT, sourceRoot);
	for (const file of walk(absoluteRoot)) {
		const relativePath = relative(ROOT, file);
		const lines = lineCount(file);
		const budget = LARGE_FILE_BUDGETS[relativePath];
		const maxLines = budget?.maxLines ?? DEFAULT_MAX_LINES;

		if (lines > maxLines) {
			failures.push(
				budget
					? `${relativePath} has ${lines} lines, over its ${maxLines}-line allowlist budget. ${budget.reason}`
					: `${relativePath} has ${lines} lines, over the ${DEFAULT_MAX_LINES}-line source budget. Split by domain or add a documented allowlist entry with a bounded maxLines value.`,
			);
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
