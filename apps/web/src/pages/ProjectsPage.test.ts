import { useToast } from '@bohr/ui';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetOrgs, setContext } from '../orgs';
import { loadSession } from '../session';
import { type FakeRoute, fakeApi, ME, mountAt, projectSummary } from '../test-utils';

const PROJECTS = [
  projectSummary({
    id: 'p1',
    name: 'Loja',
    updatedAt: '2026-10-10T12:00:00.000Z',
    lastDeploy: { status: 'success', branch: 'main', createdAt: '2026-10-10T12:00:00.000Z' },
  }),
  projectSummary({ id: 'p2', name: 'Blog', mode: 'managed', repository: 'ana/blog', lastDeploy: null }),
  projectSummary({ id: 'p3', name: 'Receitas', role: 'member', repository: 'bia/receitas' }),
];

async function mountProjects(routes: Record<string, FakeRoute | FakeRoute[]> = {}) {
  const api = fakeApi({
    'GET /api/me': { body: ME },
    'GET /api/orgs': { body: { orgs: [] } },
    'GET /api/projects': { body: { projects: PROJECTS } },
    ...routes,
  });
  await loadSession(true);
  const mounted = await mountAt('/projects');
  await flushPromises();
  return { ...mounted, api };
}

type Wrapper = Awaited<ReturnType<typeof mountProjects>>['wrapper'];

const dialog = () => document.querySelector<HTMLElement>('[data-batch-delete]');
const dialogButton = (action: string) => dialog()?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
const rows = (wrapper: Wrapper) => wrapper.findAll('tbody tr').map((row) => row.attributes('data-project'));
const checkbox = (wrapper: Wrapper, id: string) => wrapper.get<HTMLInputElement>(`input[data-select="${id}"]`);

function type(input: HTMLInputElement | null | undefined, value: string) {
  if (input === null || input === undefined) throw new Error('No input.');
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('projects page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useToast().clear();
    resetOrgs();
    setContext(null);
    window.localStorage.clear();
    document.body.innerHTML = '';
  });

  it('lists the personal scope as cards or as a list, and remembers the choice per user', async () => {
    const { wrapper, api, missing } = await mountProjects();

    expect(api.callsTo('GET /api/projects')[0]?.query.get('scope')).toBe('personal');
    expect(wrapper.findAll('.project-card')).toHaveLength(3);
    expect(wrapper.get('[data-view="cards"]').attributes('aria-pressed')).toBe('true');

    await wrapper.get('[data-view="list"]').trigger('click');
    expect(wrapper.get('[data-view="list"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.find('.project-card').exists()).toBe(false);
    // Sorted by name
    expect(rows(wrapper)).toEqual(['p2', 'p1', 'p3']);
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual([
      '',
      'Projeto',
      'Repositório',
      'Situação',
      'Atualizado',
    ]);
    expect(wrapper.get('[data-project="p1"] [data-last-deploy]').text()).toContain('Último deploy: publicado · main');
    expect(wrapper.get('[data-project="p2"] [data-last-deploy]').text()).toBe('Nenhum deploy ainda');
    expect(wrapper.get('[data-project="p1"] time').attributes('datetime')).toBe('2026-10-10T12:00:00.000Z');
    // Members cannot delete: their projects cannot be selected
    expect(checkbox(wrapper, 'p3').element.disabled).toBe(true);
    expect(checkbox(wrapper, 'p3').attributes('aria-label')).toBe('Receitas: só quem é dono pode excluir');
    expect(JSON.parse(window.localStorage.getItem('bohr.projectsView') ?? '{}')).toEqual({ u_1: 'list' });
    expect(missing).toEqual([]);

    // Back on the page, the list it is
    document.body.innerHTML = '';
    const again = await mountProjects();
    expect(again.wrapper.find('table[data-table="projects"]').exists()).toBe(true);
  });

  it('shows the picture of each production site once it loads, and the usual card without one', async () => {
    const { wrapper } = await mountProjects();
    const shots = wrapper.findAll('.project-card [data-screenshot]');
    // Sorted by name, like the list
    expect(shots.map((shot) => shot.get('img').attributes('src'))).toEqual([
      '/api/projects/p2/screenshot',
      '/api/projects/p1/screenshot?v=2026-10-10T12%3A00%3A00.000Z',
      '/api/projects/p3/screenshot',
    ]);
    // Hidden until the image loads
    expect(shots.every((shot) => !shot.isVisible())).toBe(true);

    await shots[0]?.get('img').trigger('load');
    await shots[1]?.get('img').trigger('error');
    expect(wrapper.get('.project-card [data-screenshot]').isVisible()).toBe(true);
    expect(wrapper.findAll('.project-card [data-screenshot]')).toHaveLength(2);

    // The list has a small one beside each name
    await wrapper.get('[data-view="list"]').trigger('click');
    expect(wrapper.find('[data-project="p1"] .project-screenshot--thumb img').exists()).toBe(true);
  });

  it('has no picture for a project without a production address', async () => {
    const { wrapper } = await mountProjects({
      'GET /api/projects': { body: { projects: [projectSummary({ productionUrl: null })] } },
    });
    expect(wrapper.find('.project-card').exists()).toBe(true);
    expect(wrapper.find('[data-screenshot]').exists()).toBe(false);
  });

  it('selects projects and deletes them in a batch, after the word is typed, listing what failed', async () => {
    window.localStorage.setItem('bohr.projectsView', JSON.stringify({ u_1: 'list' }));
    const { wrapper, api, missing } = await mountProjects({
      'DELETE /api/projects/p1': { body: { warnings: ['site Worker: not found'] } },
      'DELETE /api/projects/p2': { status: 500, body: { error: 'Cloudflare is down.' } },
    });
    const deleteButton = () => wrapper.get<HTMLButtonElement>('[data-action="batch-delete"]');

    expect(deleteButton().element.disabled).toBe(true);
    await checkbox(wrapper, 'p1').setValue(true);
    expect(wrapper.get('[data-batch]').text()).toContain('1 projeto selecionado');
    // Select all: every project the user can delete
    await wrapper.get('input[data-select="all"]').setValue(true);
    expect(checkbox(wrapper, 'p2').element.checked).toBe(true);
    expect(checkbox(wrapper, 'p3').element.checked).toBe(false);
    expect(wrapper.get('[data-batch]').text()).toContain('2 projetos selecionados');

    await deleteButton().trigger('click');
    await flushPromises();
    expect(dialog()?.textContent).toContain('Excluir 2 projetos?');
    expect([...(dialog()?.querySelectorAll('[data-batch-project]') ?? [])].map((item) => item.textContent)).toEqual([
      expect.stringContaining('Blog'),
      expect.stringContaining('Loja'),
    ]);
    expect(dialogButton('confirm-batch-delete')?.disabled).toBe(true);
    type(dialog()?.querySelector<HTMLInputElement>('input[type="text"]'), 'excluí');
    await flushPromises();
    expect(dialogButton('confirm-batch-delete')?.disabled).toBe(true);
    type(dialog()?.querySelector<HTMLInputElement>('input[type="text"]'), ' Excluir ');
    dialog()?.querySelector<HTMLInputElement>('input[name="deleteSite"]')?.click();
    await flushPromises();
    expect(dialogButton('confirm-batch-delete')?.disabled).toBe(false);

    dialogButton('confirm-batch-delete')?.click();
    await flushPromises();
    await flushPromises();

    // Each project with the danger zone's call; the site only goes for projects in the owner's account (byo)
    expect(api.callsTo('DELETE /api/projects/p1')[0]?.body).toEqual({ confirm: 'Loja', deleteSite: true });
    expect(api.callsTo('DELETE /api/projects/p2')[0]?.body).toEqual({ confirm: 'Blog', deleteSite: false });
    expect(dialog()?.querySelector('[data-progress]')?.textContent).toContain('Excluídos: 1. Com falha: 1.');
    expect(dialog()?.querySelector('[data-batch-project="p1"]')?.getAttribute('data-result')).toBe('deleted');
    expect(dialog()?.querySelector('[data-batch-project="p2"]')?.getAttribute('data-result')).toBe('failed');
    expect(useToast().toasts.map((toast) => toast.message)).toEqual([
      '1 projeto excluído.',
      'O projeto foi excluído, mas algo ficou para trás: Loja: site Worker: not found',
    ]);
    // The deleted one leaves the list; the failed one stays selected for another try
    expect(rows(wrapper)).toEqual(['p2', 'p3']);
    expect(checkbox(wrapper, 'p2').element.checked).toBe(true);

    dialogButton('close-batch-delete')?.click();
    await flushPromises();
    expect(dialog()).toBeNull();
    expect(missing).toEqual([]);
  });
});
