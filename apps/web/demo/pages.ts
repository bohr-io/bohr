// HTML pages the demo serves itself: the project preview (in the panel's iframe), a stand-in for Stripe
// and the instance's setup page.
import type { DemoProject } from './data.ts';

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function page(title: string, style: string, body: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.5}
${style}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

const PRODUCTS = [
  ['Vestido Midi Aurora', 'R$ 189,90', '#f4c7b8'],
  ['Blusa de Linho Areia', 'R$ 129,90', '#e8dcc4'],
  ['Saia Plissada Verão', 'R$ 149,90', '#c9e4de'],
  ['Macacão Terracota', 'R$ 219,90', '#e0a383'],
  ['Camisa Listrada Mar', 'R$ 139,90', '#bcd4e6'],
  ['Vestido Floral Lume', 'R$ 199,90', '#f2d3e0'],
] as const;

/** The site as the preview ("homologação") shows it, with the changes nobody approved yet. */
export function previewPage(project: DemoProject): string {
  const state = project.agent?.state ?? null;
  const name = project.summary.name;
  const version = state?.homolog.version ?? 0;
  const changes = state?.homolog.changes ?? [];
  const has = (words: string) => changes.some((change) => change.summary.toLowerCase().includes(words));

  const banner = `<div class="homolog">Homologação · versão ${version} · ${
    changes.length === 0
      ? 'igual à produção'
      : `${changes.length} mudança${changes.length === 1 ? '' : 's'} esperando aprovação`
  }</div>`;
  const list =
    changes.length === 0
      ? ''
      : `<ul class="changes">${changes.map((change) => `<li>${escapeHtml(change.summary)}</li>`).join('')}</ul>`;

  if (project.summary.id !== 'p1') {
    return page(
      `${name} · homologação`,
      `.homolog{position:sticky;top:0;background:#ffcc00;color:#1a1a1a;font-weight:700;padding:10px 16px;text-align:center}
.hero{min-height:70vh;display:grid;place-content:center;text-align:center;padding:32px;background:linear-gradient(135deg,#0e171d,#24384a);color:#fff}
.hero h1{font-size:clamp(32px,6vw,56px);margin:0}.changes{max-width:640px;margin:24px auto;padding:0 32px}`,
      `${banner}<section class="hero"><h1>${escapeHtml(name)}</h1><p>Prévia do site na homologação.</p></section>${list}`,
    );
  }

  return page(
    'Loja Aurora · homologação',
    `.homolog{position:sticky;top:0;z-index:2;background:#ffcc00;color:#1a1a1a;font-weight:700;padding:10px 16px;text-align:center}
.free{background:#2e7d32;color:#fff;text-align:center;padding:8px;font-weight:600}
header{display:flex;justify-content:space-between;align-items:center;padding:18px 24px;border-bottom:1px solid #eee}
header strong{font-size:22px;letter-spacing:1px;color:#b4533c}nav a{margin-left:16px;color:#333;text-decoration:none}
.hero{padding:48px 24px;background:#fbf3ee;text-align:center}.hero h1{margin:0;font-size:clamp(28px,5vw,44px);color:#3b2a24}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:20px;padding:24px}
.card{border:1px solid #eee;border-radius:10px;overflow:hidden}.photo{height:160px}.card div{padding:12px}
.card h3{font-size:15px;margin:0 0 4px}.price{color:#b4533c;font-weight:700}
.buy{display:block;margin-top:8px;padding:8px;border:0;border-radius:6px;background:#3b2a24;color:#fff;width:100%}
.wa{display:block;margin-top:6px;padding:6px;border-radius:6px;background:#25d366;color:#fff;text-align:center;font-size:13px;text-decoration:none}
.changes{margin:0;padding:12px 24px 12px 40px;background:#fffbe6;border-bottom:1px solid #f0e2a0;font-size:14px}
footer{padding:24px;text-align:center;color:#777;font-size:13px}`,
    `${banner}${list}
${has('frete grátis') ? '<div class="free">Frete grátis em compras acima de R$ 199</div>' : ''}
<header><strong>AURORA</strong><nav><a href="#">Novidades</a><a href="#">Vestidos</a><a href="#">Verão</a><a href="#">Trocas</a></nav></header>
<section class="hero"><h1>Coleção Verão 2027</h1><p>Leveza para os dias de sol.</p></section>
<section class="grid">${PRODUCTS.map(
      ([title, price, color]) => `<article class="card"><div class="photo" style="background:${color}"></div><div>
<h3>${title}</h3><span class="price">${price}</span><button class="buy" type="button">Comprar</button>${
        has('whatsapp') ? '<a class="wa" href="#">Comprar pelo WhatsApp</a>' : ''
      }</div></article>`,
    ).join('')}</section>
<footer>Loja Aurora · Demonstração da bohr</footer>`,
  );
}

const CARD = `body{min-height:100vh;display:grid;place-items:center;background:#0e171d;color:#fff;padding:24px}
.card{max-width:440px;padding:32px;border-radius:12px;background:#1b2a35;box-shadow:0 10px 40px #0008}
h1{margin-top:0;font-size:24px}p{color:#c5d0d8}a{display:inline-block;margin-top:12px;padding:10px 18px;border-radius:8px;background:#ff6d3f;color:#fff;font-weight:700;text-decoration:none}`;

/** Stands in for Stripe Checkout and the customer portal. */
/** Stripe stand-in; `back` is where its link returns (an organization's page for its subscription). */
export function stripePage(portal: boolean, back = portal ? '/billing' : '/billing?billing=success'): string {
  return page(
    'Stripe (demonstração)',
    CARD,
    `<div class="card"><h1>${portal ? 'Portal de cobrança' : 'Pagamento'} da Stripe</h1>
<p>Na demonstração não há Stripe: ${portal ? 'aqui você gerenciaria a assinatura do bohr.io Cloud.' : 'aqui você pagaria a assinatura do bohr.io Cloud.'}</p>
<a href="${back}">Voltar para a bohr</a></div>`,
  );
}

/** The instance's setup page; the demo instance is already set up. */
export function setupPage(): string {
  return page(
    'Configuração da instância (demonstração)',
    CARD,
    `<div class="card"><h1>Instância configurada</h1>
<p>Na demonstração, a instância já tem o app do GitHub e o bot do Telegram.</p><a href="/projects">Abrir os projetos</a></div>`,
  );
}

/**
 * A stand-in for the picture the instance takes of a project's production site (GET /api/projects/:id/screenshot):
 * a page drawn from the project's name, in a color of its own.
 */
export function screenshotSvg(project: DemoProject): string {
  const name = escapeHtml(project.summary.name);
  const host = escapeHtml((project.summary.productionUrl ?? '').replace(/^https?:\/\//, ''));
  const hue = [...project.summary.id].reduce((sum, char) => sum + char.charCodeAt(0) * 47, 0) % 360;
  const cards = [0, 1, 2]
    .map(
      (index) =>
        `<rect x="${120 + index * 360}" y="520" width="320" height="200" rx="16" fill="hsl(${hue} 40% ${92 - index * 4}%)"/>` +
        `<rect x="${148 + index * 360}" y="660" width="180" height="16" rx="8" fill="hsl(${hue} 30% 60%)"/>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
<rect width="1280" height="800" fill="hsl(${hue} 50% 97%)"/>
<rect width="1280" height="72" fill="#fff"/>
<circle cx="140" cy="36" r="14" fill="hsl(${hue} 70% 50%)"/>
<text x="168" y="44" font-family="system-ui, sans-serif" font-size="22" font-weight="700" fill="#1d2429">${name}</text>
<text x="1160" y="42" text-anchor="end" font-family="system-ui, sans-serif" font-size="16" fill="#6b7780">${host}</text>
<text x="120" y="250" font-family="system-ui, sans-serif" font-size="72" font-weight="800" fill="#1d2429">${name}</text>
<rect x="120" y="300" width="560" height="20" rx="10" fill="hsl(${hue} 20% 80%)"/>
<rect x="120" y="336" width="420" height="20" rx="10" fill="hsl(${hue} 20% 85%)"/>
<rect x="120" y="400" width="200" height="56" rx="28" fill="hsl(${hue} 70% 50%)"/>
<circle cx="960" cy="300" r="170" fill="hsl(${hue} 70% 80%)"/>
<circle cx="1040" cy="380" r="90" fill="hsl(${(hue + 40) % 360} 70% 70%)"/>
${cards}
</svg>`;
}
