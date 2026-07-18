import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDir, '../../../..');

describe('feed pipeline rollout configuration', () => {
	it('uses v2 for both production processes while retaining a safe local legacy default', () => {
		const compose = readFileSync(resolve(repositoryRoot, 'docker-compose.yml'), 'utf8');
		const exampleEnv = readFileSync(resolve(repositoryRoot, '.env.example'), 'utf8');
		const productionDefaults = compose.match(/FEED_PIPELINE_MODE: \$\{FEED_PIPELINE_MODE:-v2\}/g);

		expect(productionDefaults).toHaveLength(2);
		expect(exampleEnv).toMatch(/^FEED_PIPELINE_MODE=legacy$/m);
		expect(compose).not.toMatch(/FEED_PIPELINE_MODE:.*legacy/);
	});

	it('configures conservative bounded cleanup on the production worker', () => {
		const compose = readFileSync(resolve(repositoryRoot, 'docker-compose.yml'), 'utf8');
		expect(compose).toContain(
			`FEED_INGESTION_HISTORY_RETENTION_DAYS: \${FEED_INGESTION_HISTORY_RETENTION_DAYS:-14}`,
		);
		expect(compose).toContain(
			`FEED_INGESTION_CLEANUP_BATCH_SIZE: \${FEED_INGESTION_CLEANUP_BATCH_SIZE:-250}`,
		);
	});
});
