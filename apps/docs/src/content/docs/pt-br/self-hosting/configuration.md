---
title: Referência de configuração
description: Os secrets, as variáveis e os bindings que uma instância auto-hospedada da bohr lê.
sidebar:
  order: 4
---

Uma instância auto-hospedada é configurada pelo `wrangler.jsonc` da raiz do repositório e por secrets do Worker (`npx wrangler secret put <NAME>`). Para desenvolvimento local, coloque os secrets em `.dev.vars` (o git o ignora; o `.dev.vars.example` lista todos).

## Secrets

| Secret | Obrigatório | Descrição |
| --- | --- | --- |
| `ADMIN_TOKEN` | Sim | Protege o `/setup` e a API de administração. Pelo menos 32 caracteres aleatórios: `openssl rand -hex 32`. |
| `ENCRYPTION_KEY` | Sim | A chave mestra do cofre: 32 bytes aleatórios em base64 (`openssl rand -base64 32`). Aceita várias chaves durante a [rotação](/pt-br/self-hosting/updates-and-backups/#rotacionar-a-chave-mestra): `k2:<new>,k1:<old>`, a atual primeiro. Guarde uma cópia. |
| `TELEGRAM_BOT_TOKEN` | Não | O [bot da plataforma](/pt-br/self-hosting/optional-features/#o-bot-da-plataforma), para o onboarding pelo Telegram e para vincular contas do Telegram. |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET` | Não | Um app do GitHub existente, em vez de criar um em `/setup`. |

## Variáveis (`vars`)

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `APP_URL` | vazio | A URL pública da instância. Deixe vazio para usar o endereço com que você abre o `/setup`. |
| `OIDC_AUDIENCE` | `bohr.io` | A audience que a instância espera nos tokens OIDC do GitHub vindos dos workflows de deploy. Mantenha `bohr.io`: a action de deploy pede essa audience. |
| `BOHR_TELEMETRY` | não definida | `off` (ou `0`, `false`) mantém a [telemetria](/pt-br/self-hosting/telemetry/) desligada, diga o painel o que disser. |
| `EMAIL_FROM` | `bohr <noreply@<instance host>>` | O remetente dos códigos de login, por exemplo `bohr <login@mail.example.com>`. Só com o binding `EMAIL`. |
| `RUNTIME_IMAGE` | `ghcr.io/bohr-io/agent:<version>` | A [imagem do agente](/pt-br/self-hosting/optional-features/#sua-própria-imagem-do-agente) copiada para cada conta que roda projetos. Também pode ser um secret. |

## Bindings

| Binding | Tipo | Descrição |
| --- | --- | --- |
| `DB` | D1 | O banco de dados da instância (`bohr`). Criado pelo wrangler no primeiro deploy; migrations em `apps/instance/migrations`. |
| `PROVISION` | Workflow (`bohr-provision`) | Prepara o runtime de cada projeto na conta do dono. |
| `ASSETS` | Static assets | O painel web, com build em `apps/web/dist`. |
| `EMAIL` | Send email | Opcional: [login com um código por e-mail](/pt-br/self-hosting/optional-features/#login-com-um-código-por-e-mail). |
| `CLAUDE_LOGIN` | Durable Object + container | Opcional: o [container de login dedicado](/pt-br/self-hosting/optional-features/#um-container-de-login-dedicado). |

## Cron

`17 * * * *` (de hora em hora): limpeza (sessões de deploy vencidas e códigos de uso único) e, quando ligado, o ping diário de telemetria.

## Rotas que o Worker responde primeiro

`/api/*`, `/auth/*`, `/setup`, `/setup/*`, `/.well-known/*` e `/health`. Todo o resto é o painel web (uma single-page app).

:::note
O bohr.io Cloud faz o deploy do `apps/instance/wrangler.jsonc`, com a hospedagem dos projetos migrados da v1 e a cobrança ligadas. As instâncias auto-hospedadas fazem o deploy do `wrangler.jsonc` da raiz, que deixa essas partes desligadas; você não precisa de nenhuma das configurações delas.
:::
