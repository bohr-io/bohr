// Types `ctx.exports` (loopback bindings to this Worker's own exports).
declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import('./index');
    durableNamespaces: 'Project';
  }
}
