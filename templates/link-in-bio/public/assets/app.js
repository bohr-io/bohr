import { $, api, h, ready, t, toast } from './ui.js';

// The public page: avatar, name, bio, social icons and one big button per visible link.
// Every button points to /go/<id>, which counts the click on the server and redirects (works without JS).

/** Where each social handle leads (the handle only has letters, digits, dot, dash and underscore). */
const SOCIAL_URLS = {
  instagram: (handle) => `https://instagram.com/${handle}`,
  tiktok: (handle) => `https://www.tiktok.com/@${handle}`,
  youtube: (handle) => `https://www.youtube.com/@${handle}`,
  x: (handle) => `https://x.com/${handle}`,
  linkedin: (handle) => `https://www.linkedin.com/in/${handle}`,
  github: (handle) => `https://github.com/${handle}`,
};

/** An icon from the sprite in index.html. */
function icon(name, className = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

/** The first letter of the name, for the circle shown without a photo. */
function initial(name) {
  return ([...name.trim()][0] ?? '?').toUpperCase();
}

function renderAvatar(name, avatarUrl) {
  const box = $('#avatar');
  const letter = () => box.replaceChildren(h('span', { class: 'avatar-initial', 'aria-hidden': 'true' }, initial(name)));
  if (!avatarUrl) return letter();
  const image = h('img', { src: avatarUrl, alt: t('page.avatarAlt', { name }), referrerpolicy: 'no-referrer', width: 112, height: 112 });
  image.addEventListener('error', letter, { once: true });
  box.replaceChildren(image);
}

function render(profile) {
  // The color preset: app.css defines the CSS variables of each [data-theme]
  document.documentElement.dataset.theme = profile.theme || 'rose';
  const name = profile.name || t('page.defaultName');
  // The sample bio shows only while the page is not set up (no name yet)
  const bio = profile.bio || (profile.name ? '' : t('page.defaultBio'));
  document.title = profile.name || t('page.title');
  $('#name').textContent = name;
  $('#bio').textContent = bio;
  $('#bio').hidden = bio === '';
  renderAvatar(name, profile.avatar_url);

  const socials = Object.entries(profile.socials ?? {}).filter(([network, handle]) => handle && SOCIAL_URLS[network]);
  $('#socials').replaceChildren(
    ...socials.map(([network, handle]) =>
      h(
        'li',
        {},
        h(
          'a',
          { class: 'social', href: SOCIAL_URLS[network](encodeURIComponent(handle)), rel: 'me noopener', 'aria-label': t(`social.${network}`), title: t(`social.${network}`) },
          icon(network),
        ),
      ),
    ),
  );
  $('#socials').hidden = socials.length === 0;

  $('#links').replaceChildren(
    ...profile.links.map((link) =>
      h(
        'li',
        {},
        h(
          'a',
          { class: 'link', href: `/go/${link.id}` },
          h('span', { class: 'link-icon' }, icon(link.icon)),
          h('span', { class: 'link-title' }, link.title),
          icon('arrow', 'icon link-arrow'),
        ),
      ),
    ),
  );
  $('#empty').hidden = profile.links.length > 0;
}

async function load() {
  ready();
  try {
    render(await api('/api/profile'));
  } catch {
    render({ name: '', bio: '', avatar_url: '', theme: 'rose', socials: {}, links: [] });
  }
}

// Share: the phone's share sheet when there is one, otherwise copy the address
$('#share').addEventListener('click', async () => {
  const address = location.origin + location.pathname;
  if (navigator.share) {
    try {
      await navigator.share({ title: document.title, url: address });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(address);
    toast(t('page.copied'));
  } catch {
    // Clipboard blocked: nothing else to do
  }
});

load();
