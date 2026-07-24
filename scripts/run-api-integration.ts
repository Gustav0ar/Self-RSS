import { runBun, startTestServices } from './test-env.js';

const services = await startTestServices('rss-api-integration');
const focusedArgs = Bun.argv.slice(2);

try {
	runBun(['run', '--filter', '@self-feed/api', 'db:migrate'], { env: services.env });
	runBun(['run', '--filter', '@self-feed/api', 'test:integration', ...focusedArgs], {
		env: services.env,
	});
} finally {
	await services.stop();
}
