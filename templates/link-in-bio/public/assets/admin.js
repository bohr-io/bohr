import { $, adminGate, api, busy, errorText, formatDateTime, formatNumber, formValues, h, lang, t, toast } from './ui.js';

// The admin: links (add, edit, hide, delete, reorder, clicks) and the profile (name, bio, photo, color, socials).

const THEMES = ['rose', 'violet', 'ocean', 'forest', 'sunset', 'mono'];
const SOCIALS = [
  ['instagram', 'instagram.com/'],
  ['tiktok', 'tiktok.com/@'],
  ['youtube', 'youtube.com/@'],
  ['x', 'x.com/'],
  ['linkedin', 'linkedin.com/in/'],
  ['github', 'github.com/'],
];

const state = { links: [], days: [], max: 100, editing: null };

function selectTab(name) {
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    const selected = tab.id === `tab-${name}`;
    tab.setAttribute('aria-selected', String(selected));
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
  }
}

/** Reloads the phone preview next to the admin after a change. */
function refreshPreview() {
  try {
    $('#preview-frame').contentWindow?.location.reload();
  } catch {
    // The preview is not loaded yet
  }
}

/**
 * Accepts what people usually paste: "site.com" becomes https://site.com, an email becomes mailto: and a phone
 * number becomes tel:. The server still validates the result.
 */
function normalizeUrl(value) {
  const address = value.trim();
  if (address === '' || /^[a-z][a-z0-9+.-]*:/i.test(address)) return address;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return `mailto:${address}`;
  if (/^\+?[0-9().\-\s]{6,}$/.test(address)) return `tel:${address.replace(/[^\d+]/g, '')}`;
  return `https://${address}`;
}

function clicksText(count) {
  return count === 1 ? t('links.clicksOne') : t('links.clicksMany', { count: formatNumber(count) });
}

/** Seven small bars, one per day (oldest first), with the numbers for screen readers. */
function sparkline(series) {
  const top = Math.max(...series, 1);
  const dayName = new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' });
  const values = series.map((value, index) => `${dayName.format(new Date(`${state.days[index]}T12:00:00Z`))} ${value}`).join(', ');
  return h(
    'span',
    { class: 'spark', role: 'img', 'aria-label': t('links.chart', { values }), title: values },
    series.map((value) => {
      const bar = h('span', { class: value === 0 ? 'bar zero' : 'bar' });
      bar.style.height = `${value === 0 ? 8 : Math.max(16, Math.round((value / top) * 100))}%`;
      return bar;
    }),
  );
}

function linkItem(link, index) {
  const last = index === state.links.length - 1;
  return h(
    'li',
    { class: link.visible ? 'link-item' : 'link-item is-hidden' },
    h(
      'div',
      { class: 'move' },
      h('button', {
        class: 'btn small ghost icon-btn',
        type: 'button',
        'aria-label': t('links.up', { title: link.title }),
        dataset: { move: 'up', id: link.id },
        disabled: index === 0,
        onclick: (event) => move(index, -1, event.currentTarget),
      }, h('span', { class: 'chevron up', 'aria-hidden': 'true' })),
      h('button', {
        class: 'btn small ghost icon-btn',
        type: 'button',
        'aria-label': t('links.down', { title: link.title }),
        dataset: { move: 'down', id: link.id },
        disabled: last,
        onclick: (event) => move(index, 1, event.currentTarget),
      }, h('span', { class: 'chevron down', 'aria-hidden': 'true' })),
    ),
    h(
      'div',
      { class: 'link-main' },
      h('strong', { class: 'link-name' }, link.title, link.visible ? null : h('span', { class: 'badge' }, t('links.hidden'))),
      h('a', { class: 'link-url muted small', href: link.url, target: '_blank', rel: 'noopener noreferrer', title: formatDateTime(link.created_at) }, link.url),
    ),
    h(
      'div',
      { class: 'link-stats' },
      sparkline(link.days),
      h('span', { class: 'link-numbers' }, h('strong', {}, clicksText(link.clicks)), h('span', { class: 'muted small' }, t('links.week', { count: formatNumber(link.week) }))),
    ),
    h(
      'div',
      { class: 'link-actions' },
      h(
        'label',
        { class: 'switch' },
        h('input', { type: 'checkbox', checked: link.visible, onchange: (event) => toggleVisible(link, event.currentTarget) }),
        h('span', {}, t('links.visible')),
      ),
      h('button', { class: 'btn small', type: 'button', text: t('links.edit'), onclick: () => openEdit(link) }),
      h('button', { class: 'btn small danger', type: 'button', text: t('common.delete'), onclick: (event) => removeLink(link, event.currentTarget) }),
    ),
  );
}

async function loadLinks() {
  const data = await api('/api/admin/links');
  state.links = data.items;
  state.days = data.days;
  state.max = data.max;
  $('#stat-total').textContent = formatNumber(data.stats.total);
  $('#stat-week').textContent = formatNumber(data.stats.week);
  $('#stat-visible').textContent = formatNumber(data.stats.visible);
  $('#link-count').textContent = t('links.count', { count: formatNumber(data.stats.links), max: formatNumber(data.max) });
  $('#link-list').replaceChildren(...state.links.map(linkItem));
  $('#empty').hidden = state.links.length > 0;
}

/** Moves a link one place up (-1) or down (+1) and keeps the keyboard focus on the moved link's button. */
async function move(index, delta, button) {
  const ids = state.links.map((link) => link.id);
  const target = index + delta;
  if (target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  const { move: direction, id } = button.dataset;
  await busy(button, async () => {
    await api('/api/admin/links/order', { method: 'PUT', body: { ids } });
    await loadLinks();
    toast(t('links.moved'));
    refreshPreview();
  });
  const same = $(`[data-move="${direction}"][data-id="${id}"]`);
  const other = $(`[data-move="${direction === 'up' ? 'down' : 'up'}"][data-id="${id}"]`);
  (same && !same.disabled ? same : other)?.focus();
}

async function saveLink(link, changes) {
  await api(`/api/admin/links/${link.id}`, {
    method: 'PUT',
    body: { title: link.title, url: link.url, visible: link.visible, ...changes },
  });
}

async function toggleVisible(link, checkbox) {
  const visible = checkbox.checked;
  const done = await busy(checkbox, async () => {
    await saveLink(link, { visible });
    toast(visible ? t('links.shown') : t('links.hiddenDone'));
    return true;
  });
  if (!done) checkbox.checked = !visible;
  await busy(null, loadLinks);
  refreshPreview();
}

async function removeLink(link, button) {
  if (!confirm(t('links.deleteConfirm', { title: link.title }))) return;
  await busy(button, async () => {
    await api(`/api/admin/links/${link.id}`, { method: 'DELETE' });
    toast(t('links.deleted'));
    await loadLinks();
    refreshPreview();
  });
}

function openEdit(link) {
  state.editing = link;
  const form = $('#edit-form');
  form.elements.title.value = link.title;
  form.elements.url.value = link.url;
  form.elements.visible.checked = link.visible;
  $('#edit-error').hidden = true;
  $('#edit-dialog').showModal();
  form.elements.title.focus();
}

/** Checks the title and address before sending; returns the values or shows the problem. */
function linkValues(form, showError) {
  const values = formValues(form);
  values.title = values.title.trim();
  values.url = normalizeUrl(values.url);
  form.elements.url.value = values.url;
  if (values.title === '') {
    showError(t('error.invalid_title'));
    form.elements.title.focus();
    return null;
  }
  if (values.url === '') {
    showError(t('error.invalid_url'));
    form.elements.url.focus();
    return null;
  }
  return values;
}

function setupLinkForms() {
  const add = $('#add-link');
  add.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = linkValues(add, (message) => toast(message, 'error'));
    if (!values) return;
    busy(event.submitter, async () => {
      await api('/api/admin/links', { method: 'POST', body: { ...values, visible: true } });
      add.reset();
      toast(t('links.added'));
      await loadLinks();
      refreshPreview();
      add.elements.title.focus();
    });
  });

  const dialog = $('#edit-dialog');
  const form = $('#edit-form');
  const error = $('#edit-error');
  const showError = (message) => {
    error.textContent = message;
    error.hidden = false;
  };
  $('#edit-cancel').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    const values = linkValues(form, showError);
    if (!values || !state.editing) return;
    const button = event.submitter;
    button.disabled = true;
    try {
      await saveLink(state.editing, values);
      dialog.close();
      toast(t('links.saved'));
      await loadLinks();
      refreshPreview();
    } catch (failure) {
      if (failure?.code === 'unauthorized') location.reload();
      showError(errorText(failure));
    } finally {
      button.disabled = false;
    }
  });
}

// Profile

function initial(name) {
  return ([...name.trim()][0] ?? '?').toUpperCase();
}

/** The photo next to the name: the image when the address looks right, otherwise the initial. */
function updateAvatarPreview() {
  const form = $('#profile');
  const box = $('#avatar-preview');
  const name = form.elements.name.value || t('page.defaultName');
  const letter = () => box.replaceChildren(h('span', { class: 'avatar-initial' }, initial(name)));
  const address = form.elements.avatar_url.value.trim();
  if (!/^https:\/\/[^\s]+\.[^\s]+/.test(address)) return letter();
  const image = h('img', { src: address, alt: '', referrerpolicy: 'no-referrer' });
  image.addEventListener('error', letter, { once: true });
  box.replaceChildren(image);
}

function updateBioCount() {
  const bio = $('#profile').elements.bio;
  $('#bio-count').textContent = t('profile.bioCount', { count: bio.value.length, max: bio.maxLength });
}

function buildProfileForm() {
  $('#themes').replaceChildren(
    ...THEMES.map((theme) =>
      h(
        'label',
        { class: 'theme-option' },
        h('input', { type: 'radio', name: 'theme', value: theme }),
        h('span', { class: 'swatch', 'data-theme': theme, 'aria-hidden': 'true' }),
        h('span', {}, t(`theme.${theme}`)),
      ),
    ),
  );
  $('#socials').replaceChildren(
    ...SOCIALS.map(([network, prefix]) =>
      h(
        'label',
        { class: 'field' },
        h('span', {}, t(`social.${network}`)),
        h(
          'span',
          { class: 'prefixed' },
          h('span', { class: 'prefix', 'aria-hidden': 'true' }, prefix),
          h('input', { name: `social_${network}`, maxlength: 60, autocomplete: 'off', spellcheck: 'false' }),
        ),
      ),
    ),
  );
  const form = $('#profile');
  form.elements.name.placeholder = t('page.defaultName');
  form.elements.bio.placeholder = t('page.defaultBio');
  form.elements.name.addEventListener('input', updateAvatarPreview);
  form.elements.avatar_url.addEventListener('input', updateAvatarPreview);
  form.elements.bio.addEventListener('input', updateBioCount);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = formValues(form);
    const body = {
      name: values.name,
      bio: values.bio,
      avatar_url: values.avatar_url,
      theme: values.theme ?? 'rose',
      socials: Object.fromEntries(SOCIALS.map(([network]) => [network, values[`social_${network}`] ?? ''])),
    };
    busy(event.submitter, async () => {
      fillProfile(await api('/api/admin/profile', { method: 'PUT', body }));
      toast(t('common.saved'));
      refreshPreview();
    });
  });
}

function fillProfile(profile) {
  const form = $('#profile');
  form.elements.name.value = profile.name;
  form.elements.bio.value = profile.bio;
  form.elements.avatar_url.value = profile.avatar_url;
  for (const radio of form.querySelectorAll('input[name="theme"]')) radio.checked = radio.value === profile.theme;
  for (const [network] of SOCIALS) form.elements[`social_${network}`].value = profile.socials[network] ?? '';
  updateAvatarPreview();
  updateBioCount();
}

async function start() {
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => selectTab(tab.id.slice(4)));
  }
  setupLinkForms();
  buildProfileForm();
  await busy(null, () => Promise.all([loadLinks(), api('/api/admin/profile').then(fillProfile)]));
}

adminGate(start);
