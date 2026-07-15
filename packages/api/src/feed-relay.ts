import { createFeedRelayHandler } from './feed-relay-handler.js';

const token = process.env.FEED_RELAY_TOKEN;
if (!token) throw new Error('FEED_RELAY_TOKEN is required');

const port = Number.parseInt(process.env.FEED_RELAY_PORT ?? '8080', 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
	throw new Error('FEED_RELAY_PORT must be a valid TCP port');
}

const server = Bun.serve({
	hostname: '0.0.0.0',
	port,
	fetch: createFeedRelayHandler({ token }),
});

console.log(`Feed relay listening on ${server.hostname}:${server.port}`);
