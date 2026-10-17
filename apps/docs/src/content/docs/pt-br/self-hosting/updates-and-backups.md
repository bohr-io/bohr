---
title: Atualizações e backups
description: Atualize a sua instância e os runtimes dos projetos, faça backup do banco de dados e rotacione a chave mestra.
sidebar:
  order: 7
---

## Atualizar a instância

Traga as mudanças do upstream para a sua cópia do repositório e faça o deploy de novo:

```sh
git pull upstream main
pnpm install
npx wrangler deploy
```

Se você usou o botão Deploy to Cloudflare, faça push das mudanças no branch de que o Workers Builds faz deploy. As novas migrations do banco de dados rodam na primeira requisição depois do deploy.

## Atualizar os runtimes dos projetos

O Worker de cada projeto (o agente, o bot e a homologação) roda a versão com que foi criado. Depois de atualizar a instância, leve todos para a nova versão:

- **Administração › Visão geral › Atualizar runtimes**, ou
- a API de administração:

  ```sh
  curl -X POST https://<your instance>/api/admin/runtimes/update -H "Authorization: Bearer <ADMIN_TOKEN>"
  ```

Enquanto um runtime é atualizado, a versão anterior continua atendendo; uma atualização que falha o deixa rodando como estava. Se você usa o [container de login dedicado](/pt-br/self-hosting/optional-features/#um-container-de-login-dedicado), copie a nova imagem dele também.

## Backup

O que guardar com segurança:

| O quê | Onde | Como |
| --- | --- | --- |
| `ENCRYPTION_KEY` | Um secret do Worker | Guarde uma cópia fora da Cloudflare (num gerenciador de senhas). Sem ela, os tokens da Cloudflare, as chaves do app do GitHub e as chaves do agente guardados não podem ser lidos. |
| `ADMIN_TOKEN` | Um secret do Worker | Guarde uma cópia; você também pode substituí-lo com `wrangler secret put`. |
| O banco de dados da instância | D1 `bohr` | `npx wrangler d1 export bohr --remote --output bohr-backup.sql`. O Time Travel do D1 também pode restaurá-lo para um momento recente. |

O banco de dados da instância guarda usuários, sessões, projetos, organizações, conexões (criptografadas) e configurações. Os membros, o chat e as publicações de cada projeto ficam no Durable Object do projeto, na conta da Cloudflare do dono; o código fica no GitHub.

## Rotacionar a chave mestra

O `ENCRYPTION_KEY` aceita várias chaves, a atual primeiro: `k2:<new base64>,k1:<old base64>`. Valores novos são criptografados com a `k2`; os antigos continuam abrindo com a `k1`. Para passar tudo para a `k2` e depois descartar a `k1`:

```sh
npx wrangler secret put ENCRYPTION_KEY   # k2:<new base64>,k1:<old base64>
curl -X POST https://<your instance>/api/admin/vault/rewrap -H "Authorization: Bearer <ADMIN_TOKEN>"
npx wrangler secret put ENCRYPTION_KEY   # k2:<new base64>
```
