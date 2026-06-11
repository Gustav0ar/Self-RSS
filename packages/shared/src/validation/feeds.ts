import { z } from 'zod';

export const createFeedSchema = z.object({
	categoryId: z.string().uuid(),
	feedUrl: z.string().url().max(2048),
	title: z.string().min(1).max(255).optional(),
});

export const updateFeedSchema = z.object({
	categoryId: z.string().uuid().optional(),
	title: z.string().min(1).max(255).optional(),
	pollingIntervalMinutes: z.number().int().min(5).max(1440).optional(),
});

export const importOpmlSchema = z.object({
	filename: z.string().min(1).max(255),
	content: z.string().min(1).max(1_000_000),
});

export type CreateFeedInput = z.infer<typeof createFeedSchema>;
export type UpdateFeedInput = z.infer<typeof updateFeedSchema>;
export type ImportOpmlInput = z.infer<typeof importOpmlSchema>;
