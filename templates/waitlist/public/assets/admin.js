import { $, adminGate, api, busy, formatDateTime, formatNumber, formValues, h, t, toast } from './ui.js';

const state = { page: 1, pages: 1, query: '' };

function selectTab(name) {
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    const selected = tab.id === `tab-${name}`;
    tab.setAttribute('aria-selected', String(selected));
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
  }
}

async function loadStats() {
  const stats = await api('/api/admin/stats');
  $('#stat-total').textContent = formatNumber(stats.total);
  $('#stat-today').textContent = formatNumber(stats.today);
  $('#stat-week').textContent = formatNumber(stats.week);
}

async function loadSignups() {
  const params = new URLSearchParams({ page: String(state.page) });
  if (state.query) params.set('q', state.query);
  const data = await api(`/api/admin/signups?${params}`);
  state.pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  $('#rows').replaceChildren(
    ...data.items.map((signup) =>
      h(
        'tr',
        {},
        h('td', {}, signup.name),
        h('td', {}, h('a', { href: `mailto:${signup.email}` }, signup.email)),
        h('td', {}, signup.phone),
        h('td', {}, signup.company),
        h('td', { class: 'wrap' }, signup.note),
        h('td', {}, signup.source),
        h('td', {}, formatDateTime(signup.created_at)),
        h(
          'td',
          {},
          h('button', {
            class: 'btn small danger',
            type: 'button',
            text: t('common.delete'),
            onclick: (event) => removeSignup(signup, event.currentTarget),
          }),
        ),
      ),
    ),
  );
  $('#empty').hidden = data.total > 0;
  $('#page-info').textContent = t('pager.info', { page: state.page, pages: state.pages });
  $('#prev').disabled = state.page <= 1;
  $('#next').disabled = state.page >= state.pages;
}

async function removeSignup(signup, button) {
  if (!confirm(t('signups.deleteConfirm', { email: signup.email }))) return;
  await busy(button, async () => {
    await api(`/api/admin/signups/${signup.id}`, { method: 'DELETE' });
    toast(t('signups.deleted'));
    await Promise.all([loadSignups(), loadStats()]);
  });
}

async function loadSettings() {
  const settings = await api('/api/admin/settings');
  const form = $('#settings');
  for (const [name, value] of Object.entries(settings)) {
    const input = form.elements[name];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = value;
    else input.value = value;
  }
}

async function start() {
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => selectTab(tab.id.slice(4)));
  }
  let timer;
  $('#search').addEventListener('input', (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = event.target.value.trim();
      state.page = 1;
      busy(null, loadSignups);
    }, 250);
  });
  $('#prev').addEventListener('click', () => {
    state.page -= 1;
    busy(null, loadSignups);
  });
  $('#next').addEventListener('click', () => {
    state.page += 1;
    busy(null, loadSignups);
  });
  $('#settings').addEventListener('submit', (event) => {
    event.preventDefault();
    busy(event.submitter, async () => {
      await api('/api/admin/settings', { method: 'PUT', body: formValues(event.target) });
      toast(t('common.saved'));
    });
  });
  await busy(null, () => Promise.all([loadStats(), loadSignups(), loadSettings()]));
}

adminGate(start);
