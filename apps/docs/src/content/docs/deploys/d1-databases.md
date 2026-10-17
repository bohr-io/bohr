---
title: D1 databases and migrations
description: Use Cloudflare D1 in a bohr project, and how migrations run on each deploy.
sidebar:
  order: 6
---

Projects in your own Cloudflare account can use **D1**, Cloudflare's SQL database. [Template](/getting-started/templates/) projects come with one.

## The binding

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

In the Worker, the database is `env.DB`.

## Migrations

Put schema changes in numbered SQL files in `migrations_dir`, one per change:

```
migrations/
  0001_init.sql
  0002_add_city.sql
```

On every production deploy, **before** `wrangler deploy`, the [deploy workflow](/deploys/deploy-workflow/) runs, for each D1 database that declares a `migrations_dir` the repository has:

```sh
npx wrangler d1 migrations apply <binding> --remote
```

D1 records which migrations it applied, so each one runs once. The workflow only gets this step when the config has such databases.

Ask the agent for schema changes in plain words (*"Save the visitor's city with each sign-up"*): it adds a new migration file instead of changing old ones.

## The preview

The preview runs `wrangler dev`, with a **local** copy of the database in the sandbox. Template previews apply the migrations locally first:

```sh
npx wrangler d1 migrations apply DB --local && npx wrangler dev --ip 0.0.0.0 --port 8080
```

Preview data is separate from production and is lost when the sandbox sleeps.

Previews deployed with [`bohr deploy`](/cli/deploy/#previews) are different: they are versions of the production Worker, with the same bindings, so they **use the production databases**, and no migrations are applied for them. `bohr deploy --prod` applies the migrations like the workflow, before deploying.

## Permissions

Creating a database needs the **D1: Edit** permission on your Cloudflare token (bohr asks for it when you create a project from a template). Applying migrations in the deploy uses the same token.

:::caution
A [rollback](/agent/versions-and-rollback/) reverts code, not data: migrations that already ran stay applied. To undo a schema change, ask the agent for a new migration that reverses it.
:::
