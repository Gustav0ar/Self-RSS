import { z } from 'zod';

export const updateAppSettingsSchema = z.object({
	registrationLocked: z.boolean().optional(),
});

export const adminCreateUserSchema = z.object({
	email: z.string().email().max(255),
	password: z.string().min(8).max(128),
	role: z.enum(['admin', 'user']).optional().default('user'),
});

export type UpdateAppSettingsInput = z.infer<typeof updateAppSettingsSchema>;
export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;
