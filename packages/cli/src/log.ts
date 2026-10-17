/** The log the deploy flow writes to: the job log in GitHub Actions (github.ts), or the terminal (consoleLogger). */
export interface Logger {
  info(message: string): void;
  warning(message: string): void;
  /** Masks a value in every later log line. */
  setSecret(secret: string): void;
  group<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

/** Formats a byte count as B, KiB, MiB or GiB. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return unit === 0 ? `${bytes} B` : `${value.toFixed(1).replace(/\.0$/, '')} ${units[unit]}`;
}

/** Escapes control characters so a file name can never start a workflow command line. */
export function printable(text: string): string {
  return text.replace(/\p{Cc}/gu, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** Pluralizes an English noun for log lines ("1 file", "2 files"). */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** The terminal's log, on stderr (stdout carries the command's result: a URL, or the JSON of --json). */
export function consoleLogger(write: (line: string) => void = (line) => process.stderr.write(`${line}\n`)): Logger {
  return {
    info: (message) => write(message),
    warning: (message) => write(`warning: ${message}`),
    // A terminal shows what its owner may see; nothing is masked
    setSecret: () => {},
    group: async (name, fn) => {
      write(`› ${name}`);
      return fn();
    },
  };
}
