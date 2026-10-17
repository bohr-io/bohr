---
title: Variáveis de ambiente
description: Variáveis do site para o Worker de produção e variáveis do build para o build no GitHub Actions, inclusive secrets.
sidebar:
  order: 5
---

**Configurações › Variáveis de ambiente** tem duas listas. Só o dono muda as variáveis; os membros veem os nomes e os valores das variáveis comuns.

## Variáveis do site

Elas chegam ao **Worker de produção** do site em tempo de execução (`env.NAME` num Worker).

- **Na sua conta da Cloudflare**, toda variável do site fica guardada como um secret do Worker de produção, então sobrevive aos deploys, e as mudanças valem na hora. A bohr guarda os valores comuns só para mostrá-los.
- **Hospedado pela bohr** (migrado da v1): as secretas valem na hora; as comuns, a partir do próximo deploy.

Uma variável do site só pode ser definida depois que o Worker do site existe: publique o site uma vez antes. Se o mesmo nome já estiver como uma entrada comum de `vars` no seu `wrangler.jsonc`, a bohr responde *"… is already set in the site's wrangler config: change it there."*

## Variáveis do build

Elas ficam guardadas **criptografadas** na bohr e são entregues ao GitHub Actions quando ele instala e faz o build do site (por exemplo `NEXT_PUBLIC_API_URL`, `SENTRY_AUTH_TOKEN`). Valem a partir do próximo deploy.

O workflow de deploy pede essas variáveis à bohr durante a execução, com o token OIDC do GitHub da execução, junto com as credenciais da Cloudflare. Nada fica guardado nos secrets do seu repositório. Veja [O workflow de deploy](/pt-br/deploys/deploy-workflow/).

## Adicionar uma variável

1. Clique em **Nova variável**.
2. Digite o **Nome** e o **Valor**. Os nomes usam letras, números e `_`, começando por uma letra ou `_`.
3. Marque **Secreta** para tudo o que for sensível: depois de salvo, o valor fica oculto e não pode ser mostrado de novo (*Valor oculto — digite para trocar*).
4. Clique em **Salvar**.

Nomes que a bohr ou o GitHub já usam são recusados: tudo o que começa com `GITHUB_`, `CLOUDFLARE_` ou `BOHR_`, e `CI`.

## No seu código

```ts
// Um Worker: as variáveis do site ficam em env
export default {
  async fetch(request: Request, env: { RESEND_API_KEY: string }) {
    // use env.RESEND_API_KEY
    return new Response('ok');
  },
};
```

As variáveis do build são variáveis de ambiente comuns durante o `install` e o `build` (`process.env.NEXT_PUBLIC_API_URL`).

:::caution
Os valores em `vars` comuns do `wrangler.jsonc` vão para o commit no seu repositório. Coloque secrets em **Variáveis do site** marcadas como **Secreta**, nunca no repositório nem no chat.
:::

## Projetos de modelo

Projetos criados a partir de um [modelo](/pt-br/getting-started/templates/) têm uma variável do site `ADMIN_PASSWORD` (secreta) com a senha da área administrativa. Troque-a aqui.
