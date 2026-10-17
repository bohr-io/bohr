// Small static pages in bohr's v1 style. They never include request data.

const STYLE = [
  'html,body{margin:0;background-color:#180B02}',
  '*,*::before,*::after{box-sizing:border-box}',
  'main{display:flex;flex-direction:column;justify-content:center;align-items:center;gap:24px;min-height:100vh;padding:24px;',
  'background-image:radial-gradient(50vw 50vw at center 800px, #E8485533 0%, #0E171D33 50vw);',
  'font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;color:#fff;text-align:center}',
  'h1{margin:0;font-size:clamp(48px,10vw,88px);font-weight:700;letter-spacing:-0.05em;line-height:1.1;color:transparent;',
  'background:linear-gradient(180deg, #F26419 0%, #E84855 100%);-webkit-background-clip:text;background-clip:text}',
  'p{margin:0;font-size:20px;font-weight:700}',
  'a{color:#fff;font-size:16px;opacity:.7;text-decoration:none}',
  'a:hover{opacity:1}',
].join('');

function render(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} - bohr.io</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${title}</h1>
<p>${message}</p>
<a href="https://bohr.io">bohr.io</a>
</main>
</body>
</html>
`;
}

const NOT_FOUND = render('Site not found', 'Nothing is published at this address.');
const SUSPENDED = render('Site suspended', 'This site is temporarily unavailable.');
const ERROR = render('Something went wrong', 'This site could not answer the request. Please try again in a moment.');
const UNAUTHORIZED = render('Sign in required', 'This site is protected by a username and password.');

function page(html: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export const notFoundPage = (): Response => page(NOT_FOUND, 404);
export const suspendedPage = (): Response => page(SUSPENDED, 503);
export const errorPage = (): Response => page(ERROR, 502);
export const unauthorizedPage = (challenge: string): Response =>
  page(UNAUTHORIZED, 401, { 'WWW-Authenticate': challenge });
