---
title: Bancos de dados D1 e migrations
description: Use o Cloudflare D1 num projeto da bohr, e como as migrations rodam em cada deploy.
sidebar:
  order: 6
---

Projetos na sua própria conta da Cloudflare podem usar o **D1**, o banco de dados SQL da Cloudflare. Projetos criados a partir de um [modelo](/pt-br/getting-started/templates/) já vêm com um.

## O binding

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "my-site",
      "database_id": "<the database's id>",
      "migrations_dir": "migrations"
    }
  ]
}
```

No Worker, o banco de dados é `env.DB`.

## Migrations

Coloque as mudanças de schema em arquivos SQL numerados dentro de `migrations_dir`, um por mudança:

```
migrations/
  0001_init.sql
  0002_add_city.sql
```

Em todo deploy de produção, **antes** do `wrangler deploy`, o [workflow de deploy](/pt-br/deploys/deploy-workflow/) roda, para cada banco D1 que declara um `migrations_dir` existente no repositório:

```sh
npx wrangler d1 migrations apply <binding> --remote
```

O D1 registra quais migrations já aplicou, então cada uma roda uma única vez. O workflow só ganha esse passo quando a config tem bancos assim.

Peça mudanças de schema ao agente com palavras simples (*"Salve a cidade do visitante em cada cadastro"*): ele adiciona um novo arquivo de migration em vez de mudar os antigos.

## A homologação

A homologação roda `wrangler dev`, com uma cópia **local** do banco de dados no sandbox. As homologações dos modelos aplicam as migrations localmente antes:

```sh
npx wrangler d1 migrations apply DB --local && npx wrangler dev --ip 0.0.0.0 --port 8080
```

Os dados da homologação são separados dos de produção e se perdem quando o sandbox dorme.

As homologações publicadas com o [`bohr deploy`](/pt-br/cli/deploy/#homologações) são diferentes: são versões do Worker de produção, com os mesmos bindings, então **usam os bancos de produção**, e nenhuma migration é aplicada para elas. O `bohr deploy --prod` aplica as migrations como o workflow, antes do deploy.

## Permissões

Criar um banco de dados exige a permissão **D1: Edit** no seu token da Cloudflare (a bohr pede essa permissão quando você cria um projeto a partir de um modelo). Aplicar as migrations no deploy usa o mesmo token.

:::caution
[Reverter](/pt-br/agent/versions-and-rollback/) desfaz o código, não os dados: as migrations que já rodaram continuam aplicadas. Para desfazer uma mudança de schema, peça ao agente uma nova migration que a reverta.
:::
