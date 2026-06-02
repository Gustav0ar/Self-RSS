import { updatePreferencesSchema } from '@self-feed/shared';
import { Hono } from 'hono';
import type { PreferencesService } from '../services/preferences.service.js';
import { parseBody } from '../utils/validation.js';

export function createPreferencesRoutes(preferencesService: PreferencesService) {
	const routes = new Hono();

	routes.get('/', async (c) => {
		const userId = c.get('userId');
		const prefs = await preferencesService.getPreferences(userId);
		return c.json({ data: prefs });
	});

	routes.patch('/', async (c) => {
		const userId = c.get('userId');
		const body = await parseBody(c, updatePreferencesSchema);
		const prefs = await preferencesService.updatePreferences(userId, body);
		return c.json({ data: prefs });
	});

	return routes;
}
