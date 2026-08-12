import { z } from 'zod';

export const productAnalyticsEventTypeSchema = z.enum([
	'app_opened',
	'offline_restore',
	'article_completed',
]);

export const productAnalyticsEventSchema = z.object({
	id: z.uuid(),
	type: productAnalyticsEventTypeSchema,
	occurredOn: z.iso.date(),
});

export const recordProductAnalyticsEventsSchema = z.object({
	events: z.array(productAnalyticsEventSchema).min(1).max(50),
});

export type ProductAnalyticsEventType = z.infer<typeof productAnalyticsEventTypeSchema>;
export type ProductAnalyticsEvent = z.infer<typeof productAnalyticsEventSchema>;
export type RecordProductAnalyticsEventsInput = z.infer<typeof recordProductAnalyticsEventsSchema>;
