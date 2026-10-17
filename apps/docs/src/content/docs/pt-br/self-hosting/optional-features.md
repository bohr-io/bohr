---
title: Recursos opcionais
description: O bot da plataforma no Telegram, o login por e-mail, o container de login dedicado e a sua própria imagem do agente.
sidebar:
  order: 5
---

## O bot da plataforma

Os usuários podem fazer o onboarding pela web. Um **bot da plataforma** também permite fazê-lo pelo Telegram (`/new`, `/status`, `/retry`), vincular a conta do Telegram à conta na bohr e criar o bot de cada projeto com um toque.

1. Crie um bot com o [@BotFather](https://t.me/BotFather). Nas configurações dele, permita que ele **gerencie outros bots** (managed bots da Bot API): é isso que deixa ele criar o bot de cada projeto. Sem isso, os usuários colam um token do BotFather.
2. Guarde o token dele:

   ```sh
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   ```

3. Aponte o bot para a instância:

   ```sh
   curl -X POST https://<your instance>/api/admin/platform-bot \
     -H "Authorization: Bearer <ADMIN_TOKEN>"
   ```

Sem um bot da plataforma, **Vincular o Telegram** diz *"Esta instância não tem um bot do Telegram configurado."*; os bots dos projetos continuam funcionando com tokens do BotFather.

## Login com um código por e-mail

Os usuários podem entrar com o GitHub, ou com um código de uso único enviado pelo [Cloudflare Email Service](https://developers.cloudflare.com/email-service/).

1. Ative o Email Sending para um domínio seu:

   ```sh
   npx wrangler email sending enable mail.example.com
   ```

2. No `wrangler.jsonc`, descomente o binding `send_email` e defina o `EMAIL_FROM`:

   ```jsonc
   "send_email": [{ "name": "EMAIL", "allowed_sender_addresses": ["login@mail.example.com"] }],
   "vars": { "EMAIL_FROM": "bohr <login@mail.example.com>" }
   ```

3. Faça o deploy de novo. Sem o binding, a página de login só oferece o GitHub.

## Um container de login dedicado

Conectar uma [assinatura Claude](/pt-br/agent/providers/#assinatura-claude-promax) roda o `claude setup-token` da CLI oficial. Sem mais nada, ele roda no container de um dos projetos do dono: o dono precisa de um projeto com o agente pronto, e um container dormindo precisa iniciar antes.

Um container dedicado pequeno, ligado à instância, elimina as duas coisas: a conexão funciona antes de existir qualquer projeto e inicia em segundos. Ele não recebe nenhum secret; o token que ele devolve vai para a instância, nunca para o navegador. Cada usuário ou organização que faz login ganha o próprio container, que para 10 minutos depois do último uso.

Ele precisa do Workers Paid na conta da instância e da imagem no registry dessa conta:

1. Crie um token da API com **Containers: Edit** na conta da instância e copie a imagem (por padrão, a versão em `runtime/claude-login/package.json`; passe outra imagem como argumento):

   ```sh
   CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account ID> node apps/instance/scripts/copy-login-image.mjs
   ```

2. No `wrangler.jsonc`, descomente `durable_objects`, `migrations` e `containers` em *"Optional: a small dedicated container"*, com o ID da sua conta na imagem (o script mostra a linha), e faça o deploy de novo.

Copie a nova imagem e atualize a tag dela quando atualizar a bohr.

## Sua própria imagem do agente

O sandbox de cada projeto roda a imagem gerada a partir de `runtime/agent`. No primeiro projeto de uma conta, a instância copia a imagem publicada (`ghcr.io/bohr-io/agent:<version>`) para o registry da Cloudflare dessa conta. Para usar o seu próprio build:

```sh
pnpm --filter @bohr/agent build
docker build --platform linux/amd64 -f runtime/agent/Dockerfile -t ghcr.io/<you>/bohr-agent:<tag> .
docker push ghcr.io/<you>/bohr-agent:<tag>
npx wrangler secret put RUNTIME_IMAGE   # ghcr.io/<you>/bohr-agent:<tag>
```

A imagem precisa ser pública (recomendamos o GitHub Container Registry ou o Google Artifact Registry; o Docker Hub limita pulls anônimos). Os Cloudflare Containers rodam imagens `linux/amd64`.
