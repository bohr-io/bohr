// Helpers of the DNS pages (domains whose zone bohr hosts).
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

/** The TTLs the record dialog offers, in seconds; 1 is automatic. */
export const TTL_OPTIONS = [1, 60, 120, 300, 600, 900, 1800, 3600, 7200, 18000, 43200, 86400] as const;

/** Types that can be proxied through Cloudflare, and those that have a priority. */
export const PROXIABLE_TYPES: readonly string[] = ['A', 'AAAA', 'CNAME'];
export const PRIORITY_TYPES: readonly string[] = ['MX', 'SRV'];

/** How Cloudflare's dashboard names a record: "www" for www.example.com, the domain itself for its apex. */
export function shortName(zone: string, name: string): string {
  return name !== zone && name.endsWith(`.${zone}`) ? name.slice(0, -(zone.length + 1)) : name;
}

/** "Auto", "5 min", "2 h", "1 day"… */
export function useTtlLabel() {
  const { t } = useI18n();
  return (ttl: number): string => {
    if (ttl === 1) return t('dns.ttl.auto');
    if (ttl % 86400 === 0) return t('dns.ttl.days', { count: ttl / 86400 }, ttl / 86400);
    if (ttl % 3600 === 0) return t('dns.ttl.hours', { count: ttl / 3600 });
    if (ttl % 60 === 0) return t('dns.ttl.minutes', { count: ttl / 60 });
    return t('dns.ttl.seconds', { count: ttl });
  };
}

/** The documentation page on these domains, in the interface's language when the docs have it. */
export function useDnsGuideUrl() {
  const { locale } = useI18n();
  return computed(() => `https://docs.bohr.io${locale.value === 'pt-BR' ? '/pt-br' : ''}/migrating-from-v1/dns/`);
}
