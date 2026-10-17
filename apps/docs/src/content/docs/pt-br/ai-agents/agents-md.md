---
title: Trecho para AGENTS.md / CLAUDE.md
description: Instruções para copiar e colar que ensinam um agente de programação a fazer deploy do seu projeto com a CLI do bohr.
sidebar:
  order: 4
---

Cole esta seção no arquivo de instruções do seu repositório: `AGENTS.md` (Codex, Cursor e muitos outros), `CLAUDE.md` (Claude Code), `.cursor/rules`, ou o que o seu agente ler. Ela diz ao agente como fazer deploy de homologações, quando não fazer deploy de produção e o que fazer em cada código de saída.

**Download:** [AGENTS.md](/pt-br/downloads/AGENTS.md) (Markdown puro).

Para acrescentá-lo ao seu `AGENTS.md` pelo terminal (ele só é adicionado se o download for de fato o trecho):

```sh
tmp=$(mktemp)
if curl -fsSL https://docs.bohr.io/pt-br/downloads/AGENTS.md -o "$tmp" && grep -q 'npx --yes bohr@latest' "$tmp" &&
  ! grep -qi '<html' "$tmp"; then
  printf '\n' >> AGENTS.md && cat "$tmp" >> AGENTS.md && echo "Adicionado ao AGENTS.md"
else
  echo "O download não é o trecho da bohr: o AGENTS.md não foi alterado." >&2
fi
rm -f "$tmp"
```

<!-- download:start -->

````markdown
## Deploy com a bohr

Este projeto faz deploy com a [bohr](https://docs.bohr.io/pt-br/). Use a CLI do bohr; nunca faça deploy com outras ferramentas.

- Autenticação: a variável de ambiente `BOHR_TOKEN` (um token do painel da bohr, Conta › Tokens). Nunca imprima, registre em log, faça commit nem passe o token na linha de comando.
- Sempre rode a CLI de forma não interativa com `--json`: `npx --yes bohr@latest <command> --json`. O stdout é exatamente um objeto JSON; os logs vão para o stderr.
- Encontre o projeto uma vez: `npx --yes bohr@latest projects --json`. Use o `id` do projeto cujo `repository` corresponde a este repositório. `mode: "managed"`: a bohr hospeda o projeto. `mode: "byo"`: ele roda na conta Cloudflare do dono, e só o token de um dono consegue fazer deploy dele (homologações também).
- Faça deploy de uma **homologação** depois de cada mudança que você quiser mostrar:
  `npx --yes bohr@latest deploy --project <id> --branch <branch> --json`
  Leia a `url` do JSON e entregue ao usuário. Use um nome de branch que descreva a mudança (por exemplo `agent/fix-contact-form`).
- **Nunca faça deploy de produção** (`--prod`) a não ser que o usuário tenha pedido explicitamente um deploy de produção nesta conversa. Produção exige o papel de dono.
- Nunca faça commit de arquivos `.env` nem de secrets. A bohr nunca publica arquivos `.git` ou `.env*`.
- Códigos de saída: 0 pronto; 1 falhou (leia `error.message`, corrija o build, tente de novo uma vez); 2 uso errado (corrija o comando); 3 não entrou ou token rejeitado (pare e peça ao usuário um `BOHR_TOKEN` válido); 4 projeto não encontrado ou não é um projeto da bohr v2 (confira `projects --json`, não chute); 5 não permitido (não tente de novo; diga ao usuário: produção sem o papel de dono, um projeto na conta Cloudflare do dono sem o papel de dono, um projeto suspenso, ou uma configuração do wrangler de outro Worker).
- Se `error.code` for `own_account_not_allowed`, este token não consegue fazer deploy do projeto: faça commit num branch, abra um pull request para o branch de produção e deixe uma pessoa fazer o merge. Não faça push no branch de produção você mesmo. Se for `own_account`, a CLI está desatualizada: rode `npx --yes bohr@latest`.
- Em projetos com `mode: "byo"`, as homologações usam os bancos D1 da produção e não aplicam migrations: pergunte ao usuário antes de fazer deploy de uma homologação que grava dados ou precisa de uma mudança de schema. Se `url` for `null`, o Worker não tem URLs de preview (`"preview_urls": true` na configuração do wrangler dele).
- As configurações de build ficam em `.bohr/deploy.json`; o servidor de desenvolvimento da homologação, em `.bohr/preview.json`. Não edite `.github/workflows/bohr-deploy.yml`: a bohr gera esse arquivo.
````

<!-- download:end -->

## Como adaptar

- Se você sempre faz deploy do mesmo projeto, troque o passo do `projects --json` pelo id dele, ou rode `bohr link` e faça commit do `.bohr/project.json`.
- Mantenha a regra de produção, a não ser que você queira mesmo que o agente publique sem perguntar, e mantenha o token limitado ao projeto de qualquer forma.
- Mantenha as regras do `own_account_not_allowed` e do D1 para projetos na sua própria conta da Cloudflare: só o token de um dono faz deploy deles, e as homologações deles usam os bancos D1 da produção ([detalhes](/pt-br/cli/deploy/#projetos-na-sua-própria-conta-da-cloudflare)).
