---
title: Config do wrangler e bindings
description: A config do wrangler que a bohr publica, os bindings que cada tipo de projeto aceita e o que é ignorado.
sidebar:
  order: 5
---

O seu site é descrito por uma **config do wrangler** padrão da Cloudflare, `wrangler.jsonc` (ou `wrangler.json`), na pasta para a qual o `.bohr/deploy.json` aponta. O agente adiciona uma se o repositório não tiver.

```jsonc
{
  "name": "my-site",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  }
}
```

`name` é o nome do seu Worker de produção. A bohr usa esse nome para encontrar o site nas [variáveis](/pt-br/projects/variables/), na [proteção por senha](/pt-br/projects/password-protection/) e nos [domínios](/pt-br/projects/domains/).

## Projetos na sua própria conta da Cloudflare

Eles fazem deploy com `wrangler deploy` na sua conta, então **todo binding que o wrangler aceita funciona**: D1, KV, R2, Durable Objects, Queues, Workflows, Containers, Hyperdrive, AI, cron triggers, routes… Os recursos a que um binding se refere precisam existir na sua conta (o agente pode criá-los, ou você cria no dashboard).

O que é bom saber:

- As `vars` da config vão para o commit no repositório; secrets ficam em **Variáveis do site** marcadas como **Secreta**.
- Com a [proteção por senha](/pt-br/projects/password-protection/) ligada, o deploy envolve o seu Worker numa barreira e define `assets.run_worker_first` como `true`, para que os arquivos estáticos também passem por ela.
- As migrations do D1 rodam antes de cada deploy: veja [Bancos de dados D1](/pt-br/deploys/d1-databases/).

## Projetos hospedados pela bohr

Projetos migrados da bohr v1 (até serem [movidos](/pt-br/migrating-from-v1/move-to-your-cloudflare/)) fazem deploy na hospedagem da bohr, que aceita um subconjunto:

| Chave | Aceita |
| --- | --- |
| `main` | Sim. Empacotado com `wrangler deploy --dry-run`. Deixe de fora num site estático. |
| `compatibility_date` | Obrigatória |
| `compatibility_flags` | Sim |
| `vars` | Só valores de texto |
| `assets.directory`, `binding`, `not_found_handling`, `html_handling`, `run_worker_first` | Sim, como no wrangler |
| Secrets | Sim, como [variáveis do site](/pt-br/projects/variables/) |
| Qualquer outro binding (`kv_namespaces`, `d1_databases`, `r2_buckets`, `durable_objects`, `queues`, `services`, `hyperdrive`, `ai`…) | Não: o deploy para com *"bohr.io Cloud managed projects support static assets, vars and secrets for now; … is not supported."* |
| `routes`, `triggers.crons`, seções `env`, `assets.base_path` | Ignorados, com um aviso |

Também nesses projetos:

- O `wrangler.toml` não é lido: converta para `wrangler.jsonc` (mesmas chaves, em JSON com comentários).
- Uma config do Cloudflare Pages (`pages_build_output_dir`) é recusada: use `"assets": { "directory": "…" }`.
- Quando o build deixa um `.wrangler/deploy/config.json` apontando para uma config gerada (como faz o plugin Vite da Cloudflare), essa config é usada.

## Static assets

Em qualquer projeto, os arquivos em `assets.directory` seguem as regras do wrangler:

- Um `.assetsignore` na raiz da pasta exclui arquivos (sintaxe do gitignore).
- `_redirects` e `_headers` na raiz são aplicados como regras de roteamento, não servidos como arquivos (até 256 KiB cada quando hospedado pela bohr).
- Cada arquivo pode ter no máximo **25 MiB** (limite da Cloudflare).
- A CLI e a action da bohr nunca publicam arquivos ou pastas `.git`, `.env` ou `.env.<name>`, diga o que disser o `.assetsignore`.
