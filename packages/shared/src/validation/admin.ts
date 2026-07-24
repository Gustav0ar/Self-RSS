import { z } from 'zod';

export const updateAppSettingsSchema = z.object({
	registrationLocked: z.boolean().optional(),
});

export const adminCreateUserSchema = z.object({
	email: z.string().email().max(255),
	password: z.string().min(8).max(128),
	role: z.enum(['admin', 'user']).optional().default('user'),
});

export const adminUpdateUserSchema = z
	.object({
		role: z.enum(['admin', 'user']).optional(),
		isActive: z.boolean().optional(),
	})
	.refine((value) => value.role !== undefined || value.isActive !== undefined, {
		message: 'At least one user field must be updated',
	});

export const adminResetPasswordSchema = z.object({
	password: z.string().min(8).max(128),
});

export type UpdateAppSettingsInput = z.infer<typeof updateAppSettingsSchema>;
export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;
export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>;
