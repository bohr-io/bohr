---
title: O ciclo de deploy
description: Como um agente de IA deve chamar a CLI, ler o JSON, reagir aos códigos de saída, e quando (não) fazer deploy de produção.
sidebar:
  order: 3
---

## 1. Encontre o projeto uma vez

```sh
npx --yes bohr@latest projects --json
```

Compare `repository` (`owner/name`) com o remote do GitHub do repositório e guarde o `id` do projeto. Confira:

- `mode`: `managed` significa que a bohr hospeda o projeto; `byo` significa que ele roda na conta Cloudflare do dono (veja [abaixo](#projetos-na-sua-própria-conta-cloudflare)). O `bohr deploy` publica os dois.
- `role`: `owner` é necessário para produção, e para qualquer deploy de um projeto `byo`.

Se o repositório tiver `.bohr/project.json` (do `bohr link`), dá para omitir `--project`.

## 2. Faça deploy de uma homologação depois de cada mudança

```sh
npx --yes bohr@latest deploy --project p3k9x0a7qd2m --branch agent/fix-contact-form --json
```

- Escolha um nome de branch que descreva a mudança; ele não precisa existir no git. Cada branch ganha o seu próprio endereço, então homologações de mudanças diferentes não se sobrescrevem.
- A CLI roda primeiro o install e o build do `.bohr/deploy.json`. Passe `--no-build` só quando o agente já fez o build do site no mesmo ambiente.
- Leia o resultado no stdout e mostre a `url` à pessoa.

```json
{ "ok": true, "url": "https://agent-fix-contact-form-shop-acme.bohr.io", "branch": "agent/fix-contact-form", "production": false, "...": "…" }
```

Schema completo: [Saída JSON](/pt-br/cli/json-output/#bohr-deploy).

## 3. Reaja ao código de saída

| Saída | O agente deve |
| --- | --- |
| 0 | Informar a `url`. |
| 1 | Ler `error.message` (e o stderr). Corrigir um erro de build e tentar de novo **uma vez**. Para `network_error`, esperar e tentar de novo uma vez. |
| 2 | Corrigir o comando ou o arquivo que a mensagem cita. `no_branch`: passar `--branch`. |
| 3 | **Parar** e pedir à pessoa um `BOHR_TOKEN` válido. Não rodar `bohr login`. |
| 4 | Conferir de novo `projects --json`. `not_a_v2_project`: parar e avisar a pessoa; a pasta não é um projeto da bohr v2. |
| 5 | **Não tentar de novo.** Explicar o motivo (`own_account_not_allowed`, `production_not_allowed`, `production_on_v1`, `worker_mismatch`, `suspended`) e fazer deploy de uma homologação quando fizer sentido. |

Todos os códigos: [Códigos de saída e erros](/pt-br/cli/exit-codes/).

## Etiqueta de homologação vs produção

- **Homologações são o padrão** e são seguras: nunca tocam a produção. Faça deploy de uma sempre que quiser que a pessoa veja uma mudança.
- **Produção só com um pedido explícito** na conversa atual, como *"publica em produção"*. Uma aprovação anterior, um build que passou ou um branch com merge não é um pedido.
- Antes de `--prod`, diga o que vai ser publicado. `--prod` vindo de um agente roda sem a pergunta de confirmação, então o agente é a última verificação.
- Nunca faça deploy de produção para corrigir um problema em produção sem perguntar; faça primeiro o deploy de uma homologação da correção.
- Não rode `bohr deploy` em loop. Um deploy por mudança relevante.

## Projetos na sua própria conta Cloudflare

O `bohr deploy` faz o deploy de projetos na conta Cloudflare do dono (`mode: "byo"`) com o wrangler, usando o token da Cloudflare que o dono conectou à bohr ([detalhes](/pt-br/cli/deploy/#projetos-na-sua-própria-conta-da-cloudflare)). O mesmo ciclo funciona, com estas diferenças:

- **Só o token de um dono** consegue fazer deploy deles, homologações incluídas. Com o de qualquer outra pessoa, a CLI sai com o código 5 e `error.code: "own_account_not_allowed"` antes de construir qualquer coisa. Aí o agente deve fazer commit da mudança num branch novo, fazer push dele, abrir um pull request para o branch de produção e deixar uma pessoa revisar e fazer o merge; o workflow do projeto faz o deploy do branch de produção. Nunca fazer push direto no branch de produção. A pessoa também pode pedir a mudança ao agente da própria bohr, no painel ou no Telegram: ela vem com uma homologação para aprovar.
- Uma homologação é uma nova versão do Worker sob um alias do branch; ela nunca muda a produção. Se `url` for `null`, o Worker não tem URLs de preview (`"preview_urls": true` na configuração do wrangler dele): avise a pessoa.
- **As homologações usam os bancos D1 da produção** e não aplicam migrations. Pergunte antes de fazer deploy de uma homologação que grava dados ou depende de uma mudança de schema.
- `--prod` aplica as migrations do D1 e depois faz o deploy. `worker_mismatch` (código de saída 5) significa que a configuração do wrangler da pasta dá outro nome de Worker: nada recebeu deploy.
- `error.code: "own_account"` só vem da CLI 4.0.0 e anteriores: rode `npx --yes bohr@latest`.
