export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
	level: LogLevel;
	msg: string;
	requestId?: string;
	[key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

const minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';

function shouldLog(level: LogLevel): boolean {
	return LOG_LEVELS[level]! >= LOG_LEVELS[minLevel]!;
}

function write(entry: LogEntry): void {
	if (!shouldLog(entry.level)) return;
	const output = JSON.stringify({ ...entry, timestamp: new Date().toISOString() });
	if (entry.level === 'error') {
		console.error(output);
	} else {
		console.log(output);
	}
}

export function createLogger(requestId?: string) {
	const base = requestId ? { requestId } : {};
	return {
		debug(msg: string, extra?: Record<string, unknown>) {
			write({ level: 'debug', msg, ...base, ...extra });
		},
		info(msg: string, extra?: Record<string, unknown>) {
			write({ level: 'info', msg, ...base, ...extra });
		},
		warn(msg: string, extra?: Record<string, unknown>) {
			write({ level: 'warn', msg, ...base, ...extra });
		},
		error(msg: string, extra?: Record<string, unknown>) {
			write({ level: 'error', msg, ...base, ...extra });
		},
	};
}

export type Logger = ReturnType<typeof createLogger>;
