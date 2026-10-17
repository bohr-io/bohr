export type LogData = Record<string, unknown>;

export interface Logger {
  info(message: string, data?: LogData): void;
  warn(message: string, data?: LogData): void;
  error(message: string, data?: LogData): void;
}

function write(level: 'info' | 'warn' | 'error', message: string, data?: LogData): void {
  const line = JSON.stringify({ at: new Date().toISOString(), level, message, ...data });
  (level === 'info' ? process.stdout : process.stderr).write(`${line}\n`);
}

/** JSON lines on stdout/stderr, which the container runtime collects. */
export const consoleLogger: Logger = {
  info: (message, data) => write('info', message, data),
  warn: (message, data) => write('warn', message, data),
  error: (message, data) => write('error', message, data),
};

export const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};
