import { z } from 'zod';

export const registerSchema = z.object({
	email: z.string().email().max(255),
	password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
	email: z.string().email(),
	password: z.string().min(1),
});

export const refreshSchema = z.object({
	refreshToken: z.string().optional(),
});

export const changePasswordSchema = z
	.object({
		currentPassword: z.string().min(1).max(128),
		newPassword: z.string().min(8).max(128),
	})
	.refine((value) => value.currentPassword !== value.newPassword, {
		message: 'New password must be different from the current password',
		path: ['newPassword'],
	});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
