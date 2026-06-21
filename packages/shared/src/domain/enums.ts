export const UserRole = {
	ADMIN: 'admin',
	USER: 'user',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const Theme = {
	LIGHT: 'light',
	DARK: 'dark',
	AMOLED: 'amoled',
	SYSTEM: 'system',
} as const;
export type Theme = (typeof Theme)[keyof typeof Theme];

export const DisplayDensity = {
	COMFORTABLE: 'comfortable',
	COMPACT: 'compact',
} as const;
export type DisplayDensity = (typeof DisplayDensity)[keyof typeof DisplayDensity];

export const SortOrder = {
	LATEST: 'latest',
	OLDEST: 'oldest',
} as const;
export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder];

export const AutoMarkReadMode = {
	DISABLED: 'disabled',
	ON_NAVIGATE: 'on_navigate',
	ON_OPEN: 'on_open',
} as const;
export type AutoMarkReadMode = (typeof AutoMarkReadMode)[keyof typeof AutoMarkReadMode];

export const SyncStatus = {
	IDLE: 'idle',
	SYNCING: 'syncing',
	ERROR: 'error',
} as const;
export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];

export const SyncRunStatus = {
	RUNNING: 'running',
	SUCCESS: 'success',
	FAILED: 'failed',
} as const;
export type SyncRunStatus = (typeof SyncRunStatus)[keyof typeof SyncRunStatus];

export const MediaType = {
	IMAGE: 'image',
	VIDEO: 'video',
	EMBED: 'embed',
} as const;
export type MediaType = (typeof MediaType)[keyof typeof MediaType];

export const MediaProvider = {
	YOUTUBE: 'youtube',
	STREAMABLE: 'streamable',
	VIMEO: 'vimeo',
	VIDEOPRESS: 'videopress',
	X: 'x',
	UNKNOWN: 'unknown',
} as const;
export type MediaProvider = (typeof MediaProvider)[keyof typeof MediaProvider];

export const ReadSource = {
	MANUAL: 'manual',
	AUTO_NAVIGATE: 'auto_navigate',
	AUTO_OPEN: 'auto_open',
	MARK_ALL: 'mark_all',
} as const;
export type ReadSource = (typeof ReadSource)[keyof typeof ReadSource];
