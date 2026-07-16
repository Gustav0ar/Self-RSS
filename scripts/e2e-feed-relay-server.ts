import { createFeedRelayHandler } from '../packages/api/src/feed-relay-handler.js';

const blockedPort = Number.parseInt(process.env.E2E_BLOCKED_FEED_PORT ?? '', 10);
const relayPort = Number.parseInt(process.env.E2E_FEED_RELAY_PORT ?? '', 10);
const relayToken = process.env.E2E_FEED_RELAY_TOKEN;

if (!Number.isInteger(blockedPort) || !Number.isInteger(relayPort) || !relayToken) {
	throw new Error('E2E relay ports and token are required');
}

const relayFeedXml = `<?xml version="1.0" encoding="UTF-8"?>
	<rss version="2.0"><channel>
		<title>Relay Hardware News</title>
		<link>https://videocardz.com</link>
		<description>Relay fallback end-to-end feed</description>
		<item>
			<title>Relay fallback article</title>
			<link>https://videocardz.com/newz/relay-fallback</link>
			<guid>relay-fallback-article</guid>
			<pubDate>Wed, 15 Jul 2026 12:00:00 GMT</pubDate>
			<description>Fetched through the authenticated fixed-upstream relay.</description>
		</item>
	</channel></rss>`;

const blockedFeedServer = Bun.serve({
	hostname: '127.0.0.1',
	port: blockedPort,
	fetch: () =>
		new Response('<html><body>Datacenter address blocked</body></html>', {
			status: 403,
			headers: { 'Content-Type': 'text/html; charset=utf-8' },
		}),
});
const relayServer = Bun.serve({
	hostname: '127.0.0.1',
	port: relayPort,
	fetch: createFeedRelayHandler({
		token: relayToken,
		upstreamFetch: async () =>
			new Response(relayFeedXml, {
				status: 200,
				headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
			}),
	}),
});

function shutdown() {
	relayServer.stop(true);
	blockedFeedServer.stop(true);
	process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
await new Promise(() => undefined);
