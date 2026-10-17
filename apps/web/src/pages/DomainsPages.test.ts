import { useToast } from '@bohr/ui';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DnsRecord, DnsZoneDetail } from '../api';
import { loadSession } from '../session';
import { type FakeRoute, fakeApi, ME, mountAt } from '../test-utils';

const record = (overrides: Partial<DnsRecord>): DnsRecord => ({
  id: 'r',
  type: 'A',
  name: 'example.com',
  content: '255.255.255.255',
  ttl: 1,
  proxied: false,
  priority: null,
  managedByBohr: false,
  editable: true,
  ...overrides,
});

const RECORDS: DnsRecord[] = [
  record({ id: 'apex', proxied: true, managedByBohr: true, editable: false }),
  record({ id: 'mx', type: 'MX', content: 'mx.zoho.com', priority: 10 }),
  record({ id: 'ns', type: 'NS', content: 'ada.ns.cloudflare.com', ttl: 86400, managedByBohr: true, editable: false }),
  record({ id: 'erp', name: 'erp.example.com', content: '203.0.113.5', ttl: 300 }),
];

const zone = (overrides: Partial<DnsZoneDetail['zone']> = {}, records = RECORDS): DnsZoneDetail => ({
  zone: { name: 'example.com', canEdit: true, access: 'member', org: null, ...overrides },
  records,
});

async function mountPage(path: string, routes: Record<string, FakeRoute | FakeRoute[]>) {
  const api = fakeApi({ 'GET /api/me': { body: ME }, ...routes });
  await loadSession(true);
  const mounted = await mountAt(path);
  return { ...mounted, api };
}

type Wrapper = Awaited<ReturnType<typeof mountPage>>['wrapper'];
const row = (wrapper: Wrapper, id: string) => wrapper.get(`[data-record="${id}"]`);
const dialog = () => document.querySelector<HTMLFormElement>('[data-record-dialog]');

async function fill(selector: string, value: string) {
  const field = dialog()?.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
  if (field === null || field === undefined) throw new Error(`No ${selector} in the dialog`);
  field.value = value;
  field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input'));
  await flushPromises();
}

describe('domains', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useToast().clear();
    document.body.innerHTML = '';
  });

  it('lists the domains with whose they are and the access', async () => {
    const { wrapper, missing } = await mountPage('/domains', {
      'GET /api/dns/zones': {
        body: {
          zones: [
            { name: 'example.com', canEdit: true, org: null },
            { name: 'acme.dev', canEdit: false, org: { slug: 'acme', name: 'Acme' } },
          ],
        },
      },
    });
    expect(wrapper.get('h1').text()).toContain('Domínios');
    const rows = wrapper.findAll('[data-zone]');
    expect(rows.map((item) => item.findAll('td').map((cell) => cell.text().trim()))).toEqual([
      ['example.com', 'Você', 'Pode editar'],
      ['acme.dev', 'Acme', 'Só leitura'],
    ]);
    expect(rows[0]?.get('a').attributes('href')).toBe('/domains/example.com');
    expect(missing).toEqual([]);
  });

  it('says so when there are none', async () => {
    const { wrapper } = await mountPage('/domains', { 'GET /api/dns/zones': { body: { zones: [] } } });
    expect(wrapper.get('[data-empty]').text()).toContain('Você não tem domínios');
  });
});

describe('a domain', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useToast().clear();
    document.body.innerHTML = '';
  });

  it('shows the records, with the ones bohr uses locked', async () => {
    const { wrapper, missing } = await mountPage('/domains/example.com', {
      'GET /api/dns/zones/example.com/records': { body: zone() },
    });
    expect(wrapper.get('h1').text()).toContain('example.com');
    const cells = (id: string) =>
      row(wrapper, id)
        .findAll('td')
        .map((cell) => cell.text().replace(/\s+/g, ' ').trim());
    expect(cells('apex')).toEqual([
      'A',
      'example.com',
      '255.255.255.255',
      'Automático',
      'Com proxy',
      '—',
      'Usado pela bohr',
    ]);
    expect(cells('mx').slice(0, 6)).toEqual(['MX', 'example.com', 'mx.zoho.com', 'Automático', '—', '10']);
    expect(cells('erp').slice(1, 5)).toEqual(['erp', '203.0.113.5', '5 min', 'Só DNS']);
    expect(cells('ns')[3]).toBe('1 dia');
    expect(row(wrapper, 'apex').find('[data-action="edit"]').exists()).toBe(false);
    expect(row(wrapper, 'erp').find('[data-action="edit"]').exists()).toBe(true);
    expect(wrapper.get('[data-action="export"]').attributes('href')).toBe('/api/dns/zones/example.com/export');
    expect(missing).toEqual([]);
  });

  it('is read-only for members of the organization', async () => {
    const { wrapper } = await mountPage('/domains/acme.dev', {
      'GET /api/dns/zones/acme.dev/records': {
        body: zone({ name: 'acme.dev', canEdit: false, org: { slug: 'acme', name: 'Acme' } }, [
          record({ id: 'mx', type: 'MX', name: 'acme.dev', content: 'mx.acme.dev', priority: 5 }),
        ]),
      },
    });
    expect(wrapper.get('[data-notice="read-only"]').text()).toContain('um admin de Acme');
    expect(wrapper.find('[data-action="add-record"]').exists()).toBe(false);
    expect(wrapper.find('[data-action="edit"]').exists()).toBe(false);
    expect(wrapper.find('[data-action="delete"]').exists()).toBe(false);
  });

  it('adds a record, and keeps the instance refusal in the dialog', async () => {
    const created = record({ id: 'vpn', name: 'vpn.example.com', content: '198.51.100.7', ttl: 3600 });
    const { wrapper, api } = await mountPage('/domains/example.com', {
      'GET /api/dns/zones/example.com/records': { body: zone() },
      'POST /api/dns/zones/example.com/records': [
        {
          status: 409,
          body: { error: 'bohr serves www.example.com: its A, AAAA and CNAME records are managed by bohr.' },
        },
        { status: 201, body: zone({}, [...RECORDS, created]) },
      ],
    });
    await wrapper.get('[data-action="add-record"]').trigger('click');
    await flushPromises();
    expect(dialog()?.textContent).toContain('Adicionar um registro');

    // Checked before calling the instance
    dialog()?.dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(dialog()?.textContent).toContain('Preencha este campo.');
    expect(api.callsTo('POST /api/dns/zones/example.com/records')).toHaveLength(0);

    await fill('input[name="name"]', 'www');
    await fill('input[name="content"]', '198.51.100.7');
    dialog()?.dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(dialog()?.querySelector('[data-error]')?.textContent).toContain('bohr serves www.example.com');

    await fill('input[name="name"]', 'vpn');
    await fill('select[name="ttl"]', '3600');
    dialog()?.dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(api.callsTo('POST /api/dns/zones/example.com/records').at(-1)?.body).toEqual({
      type: 'A',
      name: 'vpn',
      content: '198.51.100.7',
      ttl: 3600,
      proxied: false,
      priority: null,
    });
    expect(dialog()).toBeNull();
    expect(wrapper.find('[data-record="vpn"]').exists()).toBe(true);
  });

  it('edits a record with its values filled in', async () => {
    const { wrapper, api } = await mountPage('/domains/example.com', {
      'GET /api/dns/zones/example.com/records': { body: zone() },
      'PATCH /api/dns/zones/example.com/records/mx': { body: zone() },
    });
    await row(wrapper, 'mx').get('[data-action="edit"]').trigger('click');
    await flushPromises();
    expect(dialog()?.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe('@');
    expect(dialog()?.querySelector<HTMLInputElement>('input[name="priority"]')?.value).toBe('10');
    // No proxy for mail
    expect(dialog()?.querySelector('input[name="proxied"]')).toBeNull();
    await fill('input[name="priority"]', '20');
    dialog()?.dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(api.callsTo('PATCH /api/dns/zones/example.com/records/mx')[0]?.body).toEqual({
      type: 'MX',
      name: '@',
      content: 'mx.zoho.com',
      ttl: 1,
      proxied: false,
      priority: 20,
    });
  });

  it('deletes a record after asking', async () => {
    const { wrapper, api } = await mountPage('/domains/example.com', {
      'GET /api/dns/zones/example.com/records': { body: zone() },
      'DELETE /api/dns/zones/example.com/records/erp': { body: zone({}, RECORDS.slice(0, 3)) },
    });
    await row(wrapper, 'erp').get('[data-action="delete"]').trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain('Excluir este registro A?');
    const confirm = [...document.querySelectorAll('button')]
      .filter((node) => node.textContent?.trim() === 'Excluir')
      .at(-1);
    confirm?.click();
    await flushPromises();
    expect(api.callsTo('DELETE /api/dns/zones/example.com/records/erp')).toHaveLength(1);
    expect(wrapper.find('[data-record="erp"]').exists()).toBe(false);
  });
});
