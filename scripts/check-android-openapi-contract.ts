import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	compareAndroidOpenApiContract,
	operationKey,
} from '../packages/api/src/openapi/android-contract.js';

const root = resolve(import.meta.dir, '..');
const openApi = JSON.parse(readFileSync(resolve(root, 'packages/api/openapi.json'), 'utf8'));
const retrofitSource = readFileSync(
	resolve(root, 'packages/android/app/src/main/java/com/selffeed/android/network/RssApi.kt'),
	'utf8',
);
const modelsSource = readFileSync(
	resolve(root, 'packages/android/app/src/main/java/com/selffeed/android/network/ApiModels.kt'),
	'utf8',
);
const networkModuleSource = readFileSync(
	resolve(root, 'packages/android/app/src/main/java/com/selffeed/android/network/NetworkModule.kt'),
	'utf8',
);
const eventStreamSource = readFileSync(
	resolve(
		root,
		'packages/android/app/src/main/java/com/selffeed/android/data/repository/ReadStateStreamClient.kt',
	),
	'utf8',
);

const alternateTransportErrors = [
	!networkModuleSource.includes('auth/refresh')
		? 'Alternate Android refresh transport no longer references auth/refresh'
		: null,
	!eventStreamSource.includes('events/read-state')
		? 'Alternate Android SSE transport no longer references events/read-state'
		: null,
].filter((error): error is string => error != null);

const errors = compareAndroidOpenApiContract(openApi, retrofitSource, modelsSource, {
	coveredOutsideRetrofit: new Set([
		operationKey('POST', '/auth/refresh'),
		operationKey('GET', '/events/read-state'),
	]),
	// These product/admin operations are deliberately not exposed by the Android UI yet.
	intentionallyUnsupported: new Set([
		operationKey('PATCH', '/categories/reorder'),
		operationKey('GET', '/admin/product-analytics'),
		operationKey('POST', '/admin/users'),
		// Android remains on the backward-compatible read-state stream until it
		// adopts the web-only feed progress and health event handling.
		operationKey('GET', '/events/stream'),
	]),
	schemaMappings: {
		User: 'User',
		AuthSession: 'AuthSession',
		AuthSessionsResponse: 'AuthSessionsResponse',
		RegistrationStatus: 'RegistrationStatusResponse',
		CategoryTreeResult: 'CategoryTreeResponse',
		CategoryWithCounts: 'CategoryWithCounts',
		FeedWithCounts: 'FeedWithCounts',
		ArticleListItem: 'ArticleListItem',
		ArticleDetail: 'ArticleDetail',
		Preferences: 'UserPreferences',
		Stats: 'StatsResponse',
		AppSettings: 'AppSettingsResponse',
		FeedSyncAllStatus: 'FeedSyncAllStatus',
		OpmlImportSummary: 'OpmlImportSummary',
		OpmlImportWarning: 'OpmlImportWarning',
	},
	responseMappings: {
		[operationKey('GET', '/feeds')]: 'FeedWithCounts',
		[operationKey('POST', '/feeds')]: 'FeedWithCounts',
		[operationKey('PATCH', '/feeds/{feedId}')]: 'FeedWithCounts',
		[operationKey('GET', '/feeds/sync/status')]: 'FeedSyncAllStatus',
	},
});
errors.push(...alternateTransportErrors);

if (errors.length > 0) {
	console.error(`Android/OpenAPI contract check failed:\n- ${errors.join('\n- ')}`);
	process.exit(1);
}

console.log('Android/OpenAPI contract check passed.');
