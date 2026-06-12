import { z } from 'zod';

export const accentColorSchema = z.enum([
	'indigo',
	'violet',
	'rose',
	'amber',
	'emerald',
	'sky',
]);
export type AccentColorValue = z.infer<typeof accentColorSchema>;

export const updatePreferencesSchema = z.object({
	theme: z.enum(['light', 'dark', 'amoled', 'system']).optional(),
	fontFamily: z.string().min(1).max(100).optional(),
	textSize: z.number().int().min(12).max(24).optional(),
	density: z.enum(['comfortable', 'compact']).optional(),
	defaultSort: z.enum(['latest', 'oldest']).optional(),
	hideRead: z.boolean().optional(),
	keyboardShortcutsEnabled: z.boolean().optional(),
	autoMarkReadMode: z.enum(['disabled', 'on_navigate', 'on_open']).optional(),
	accentColor: accentColorSchema.optional(),
});

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
