import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApiSpec } from './spec.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(currentDir, '../../openapi.json');

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(openApiSpec, null, '\t')}\n`, 'utf8');
console.log(`OpenAPI written to ${outputPath}`);
