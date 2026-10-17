---
title: Fazer o deploy da instância
description: Instale uma instância da bohr com o botão Deploy to Cloudflare ou com o wrangler.
sidebar:
  order: 2
---

## Com o botão Deploy to Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bohr-io/bohr)

A Cloudflare copia o repositório para a sua conta do GitHub, cria o banco de dados D1 e pede dois secrets:

| Secret | Valor |
| --- | --- |
| `ADMIN_TOKEN` | Uma string aleatória de pelo menos 32 caracteres (`openssl rand -hex 32`). Protege o `/setup` e a API de administração. |
| `ENCRYPTION_KEY` | 32 bytes aleatórios em base64 (`openssl rand -base64 32`). A chave mestra do cofre. **Guarde uma cópia**: sem ela, os tokens da Cloudflare e as chaves do app do GitHub guardados não podem ser lidos. |

Deixe o `APP_URL` vazio, a menos que você já saiba o endereço final da instância.

## Com o wrangler

```sh
git clone https://github.com/bohr-io/bohr && cd bohr
pnpm install
npx wrangler login
npx wrangler deploy
npx wrangler secret put ADMIN_TOKEN      # openssl rand -hex 32
npx wrangler secret put ENCRYPTION_KEY   # openssl rand -base64 32
```

Você precisa do Node.js 22 e do pnpm 10. O `wrangler deploy` roda o build definido no `wrangler.jsonc` (ele empacota o Worker de cada projeto dentro da instância e faz o build do painel web), cria o banco de dados D1 no primeiro deploy e publica o Worker, chamado `bohr`.

A própria instância aplica as migrations do banco de dados na primeira requisição. Para aplicá-las manualmente:

```sh
npx wrangler d1 migrations apply DB --remote
```

## O endereço

A instância responde em `https://bohr.<your-subdomain>.workers.dev`, ou num domínio próprio que você adicionar ao Worker. **O endereço que você usa para abrir o `/setup` vira a URL da instância** (a menos que o `APP_URL` esteja definido), e ele entra nas URLs de callback do app do GitHub: use o seu domínio final desde o começo.

Próximo passo: [Criar o app do GitHub](/pt-br/self-hosting/github-app/).

## Conferir

```sh
curl https://<your instance>/health
```

Abrir a instância antes do `/setup` mostra *"Esta instância ainda não foi configurada"* na página de login, com um link para a configuração.
