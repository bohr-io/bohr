import { $, api, errorText, formatNumber, formValues, ready, t, toast } from './ui.js';

const form = $('#signup');

async function load() {
  ready();
  try {
    const page = await api('/api/page');
    document.title = page.title || t('page.title');
    $('#headline').textContent = page.headline || t('page.headline');
    $('#description').textContent = page.description || t('page.description');
    $('#field-phone').hidden = !page.ask_phone;
    $('#field-company').hidden = !page.ask_company;
    $('#field-note').hidden = !page.ask_note;
    if (page.count > 0) {
      $('#joined').textContent =
        page.count === 1 ? t('page.joinedOne') : t('page.joinedMany', { count: formatNumber(page.count) });
      $('#joined').hidden = false;
    }
  } catch {
    $('#headline').textContent = t('page.headline');
    $('#description').textContent = t('page.description');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = $('#error');
  error.hidden = true;
  if (!form.checkValidity()) {
    const invalid = form.querySelector(':invalid');
    error.textContent = t(invalid?.name === 'email' ? 'error.invalid_email' : 'error.invalid_name');
    error.hidden = false;
    invalid?.focus();
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const params = new URLSearchParams(location.search);
    const source = params.get('ref') || params.get('utm_source') || '';
    const result = await api('/api/signups', {
      method: 'POST',
      body: { ...formValues(form), source: source.slice(0, 100) },
    });
    form.hidden = true;
    $('#position').textContent = result.position > 0 ? t('done.position', { position: formatNumber(result.position) }) : '';
    $('#done').hidden = false;
    $('#done').focus();
  } catch (failure) {
    error.textContent = errorText(failure);
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});

$('#copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.origin + location.pathname);
    toast(t('done.copied'));
  } catch {
    // Clipboard blocked: nothing else to do
  }
});

load();
