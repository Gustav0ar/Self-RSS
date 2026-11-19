import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const useProcessGroups = process.platform !== 'win32';

/** Package scripts can start grandchildren that outlive the package runner. */
export function spawnService(command: string, args: string[], options: SpawnOptions) {
	return spawn(command, args, { ...options, detached: useProcessGroups });
}

export async function stopService(
	child: ChildProcess | undefined,
	signal: NodeJS.Signals = 'SIGTERM',
) {
	if (!child?.pid) return;
	const pid = child.pid;
	const signalService = (value: NodeJS.Signals | 0) => {
		if (!useProcessGroups) return child.kill(value);
		try {
			process.kill(-pid, value);
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
			throw error;
		}
	};
	if (!signalService(signal)) return;
	for (let attempt = 0; attempt < 50; attempt++) {
		await sleep(100);
		if (!signalService(0)) return;
	}
	signalService('SIGKILL');
}
