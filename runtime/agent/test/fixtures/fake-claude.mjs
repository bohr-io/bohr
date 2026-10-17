// Stands in for the official CLI's `claude setup-token` in the tests: terminal noise around the authorization
// URL, the code prompt, then a token or an error for the code typed on stdin.
// Usage: node fake-claude.mjs <ok|silent|exit|hang> [setup-token]
const mode = process.argv[2] ?? 'ok';
const ESC = '\u001b';
const BEL = '\u0007';
const url =
  'https://claude.com/cai/oauth/authorize?code=true&client_id=test-client&response_type=code' +
  '&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference' +
  '&code_challenge=abc&code_challenge_method=S256&state=xyz';
const TOKEN = `sk-ant-oat01-${'Ab3_'.repeat(12)}-fake`;

const write = (text) => process.stdout.write(text);

write(
  `${ESC}[?25l${ESC}[2J${ESC}[H${ESC}[1mThis will guide you through long-lived (1-year) auth token setup${ESC}[22m\r\n`,
);

if (mode === 'exit') {
  write(`${ESC}[31mError: Something broke before the sign-in started${ESC}[39m\r\n`);
  process.exit(1);
}

if (mode === 'silent') {
  setInterval(() => write(`${ESC}[2K${ESC}[1AStarting…`), 100);
} else {
  write(`${ESC}[2mBrowser didn't open? Use the url below to sign in${ESC}[22m\r\n`);
  // The URL as a hyperlink and as text, split across writes like a real terminal stream
  const line = `${ESC}]8;;${url}${BEL}${ESC}[2m${url}${ESC}[22m${ESC}]8;;${BEL}\r\n`;
  write(line.slice(0, 120));
  setTimeout(() => write(line.slice(120)), 30);
  setTimeout(() => write(`${ESC}[2K${ESC}[GPaste code here if prompted > `), 80);

  // Like Ink's text input: a chunk of several characters is a paste (an Enter inside it does not submit);
  // only an Enter on its own submits
  let input = '';
  process.stdin.on('data', (chunk) => {
    const text = chunk.toString();
    if (text !== '\r' && text !== '\n') {
      input += text.replace(/[\r\n]/g, '');
      return;
    }
    if (mode === 'hang') return;
    const code = input;
    input = '';
    // The prompt masks what is typed
    write(`${'*'.repeat(code.length)}\r\n`);
    if (code === 'good-code#state') {
      setTimeout(() => {
        write(`${ESC}[32m✓ Long-lived authentication token created successfully!${ESC}[39m\r\n`);
        write(`Your OAuth token (valid for 1 year):\r\n\r\n${ESC}[1m${TOKEN}${ESC}[22m\r\n\r\n`);
        write('Store this token securely. You will not be able to see it again.\r\n');
      }, 50);
    } else {
      write(`${ESC}[31mOAuth error: Authentication failed: Invalid authorization code${ESC}[39m\r\n`);
      write(`${ESC}[2mPress Enter to retry.${ESC}[22m\r\n`);
    }
  });
}
