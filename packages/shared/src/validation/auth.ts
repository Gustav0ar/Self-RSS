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

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
