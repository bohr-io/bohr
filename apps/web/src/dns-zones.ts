// The domains whose DNS bohr hosts that the user can see (bohr v1 customers' domains), shared by the main bar,
// which only shows "Domains" when there is one, and the domains page.
import { reactive, readonly } from 'vue';
import { api, type DnsZoneSummary } from './api';

const state = reactive({
  /** null until loaded; instances that host no zones (they answer 404) and failed loads leave it empty. */
  list: null as DnsZoneSummary[] | null,
});

let pending: Promise<DnsZoneSummary[]> | null = null;

export const dnsZones = readonly(state);

/** Loaded once (force reloads them). A failure counts as none. */
export function loadDnsZones(force = false): Promise<DnsZoneSummary[]> {
  if (!force && state.list !== null) return Promise.resolve(state.list);
  pending ??= api
    .dnsZones()
    .then(({ zones }) => zones)
    .catch(() => [] as DnsZoneSummary[])
    .then((list) => {
      state.list = list;
      return list;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Signed out or another account: nothing of the previous one stays. */
export function resetDnsZones(): void {
  state.list = null;
}
