// Dates and money in the interface language, with Intl.

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
];

function toDate(value: string | number | Date): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "14:05" today, "3 de out., 14:05" on other days. */
export function formatTime(value: string | number | Date, locale: string, now: Date = new Date()): string {
  const date = toDate(value);
  if (date === null) return '';
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(locale, {
    ...(sameDay ? {} : { day: 'numeric', month: 'short' }),
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDateTime(value: string | number | Date, locale: string): string {
  const date = toDate(value);
  return date === null ? '' : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** "11 de out. de 2026". */
export function formatDate(value: string | number | Date, locale: string): string {
  const date = toDate(value);
  return date === null ? '' : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

/** "há 5 minutos", "in 3 hours". */
export function formatRelative(value: string | number | Date, locale: string, now: number = Date.now()): string {
  const date = toDate(value);
  if (date === null) return '';
  const seconds = (date.getTime() - now) / 1000;
  const [unit, size] = UNITS.find(([, unitSize]) => Math.abs(seconds) >= unitSize) ?? ['second', 1];
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(seconds / size), unit);
}

export function formatUsd(value: number, locale: string, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value);
}
