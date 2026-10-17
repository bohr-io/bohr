// GitHub Actions job logs, made readable: the timestamp GitHub puts on every line goes, and its workflow
// commands (##[group], ##[error]…) become the kind of line they announce.

export type LogLineKind = 'plain' | 'group' | 'error' | 'warning' | 'command';

export interface LogLine {
  text: string;
  kind: LogLineKind;
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;
const COMMAND = /^##\[(group|endgroup|error|warning|notice|command|debug|section)\]/;

export function parseLog(log: string): LogLine[] {
  const lines: LogLine[] = [];
  for (const raw of log.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(TIMESTAMP, '');
    const command = line.match(COMMAND);
    if (command === null) {
      lines.push({ text: line, kind: 'plain' });
      continue;
    }
    const text = line.slice(command[0].length);
    switch (command[1]) {
      case 'endgroup':
        break;
      case 'group':
      case 'section':
        lines.push({ text, kind: 'group' });
        break;
      case 'error':
        lines.push({ text, kind: 'error' });
        break;
      case 'warning':
        lines.push({ text, kind: 'warning' });
        break;
      default:
        lines.push({ text, kind: 'command' });
    }
  }
  while (lines.length > 0 && lines[lines.length - 1]?.text === '') lines.pop();
  return lines;
}
