---
title: Saída JSON
description: A saída --json de cada comando, para scripts e agentes de IA.
sidebar:
  order: 5
---

Com `--json`, um comando imprime **exatamente um objeto JSON no stdout** e mais nada ali; progresso e logs vão para o stderr. Ele também nunca faz perguntas e nunca abre o navegador.

## Sucesso e falha

Sucesso:

```json
{ "ok": true, "...": "the command's fields" }
```

Falha:

```json
{
  "ok": false,
  "error": {
    "code": "production_not_allowed",
    "message": "Only owners of my-site (admins of its organization) can deploy production. Deploy a preview: bohr deploy",
    "exitCode": 5
  }
}
```

O processo sai com o mesmo `exitCode` ([códigos de saída](/pt-br/cli/exit-codes/)). Decida com base em `error.code`, não na mensagem.

## bohr deploy

```json
{
  "ok": true,
  "instanceUrl": "https://app.bohr.io",
  "url": "https://feature-new-menu-my-site-acme.bohr.io",
  "deploymentId": "d_…",
  "project": { "id": "p3k9x0a7qd2m", "name": "my-site" },
  "branch": "feature/new-menu",
  "production": false,
  "mode": "managed",
  "files": 42,
  "bytes": 1363148,
  "uploadedFiles": 3,
  "uploadedBytes": 20480,
  "modules": 1
}
```

| Campo | Descrição |
| --- | --- |
| `url` | Onde o branch publicado é servido |
| `deploymentId` | O id do deployment na instância |
| `project` | O projeto, ou `null` no GitHub Actions com OIDC |
| `branch`, `production` | O que foi publicado (`null` com OIDC) |
| `mode` | `managed`: um projeto que a bohr hospeda. `byo`: um projeto na conta Cloudflare do dono (abaixo) |
| `files`, `bytes` | Arquivos estáticos na pasta de assets, e o tamanho total deles |
| `uploadedFiles`, `uploadedBytes` | O que de fato foi enviado (arquivos novos ou alterados) |
| `modules` | Módulos do Worker (0 para um site estático) |

### Projetos na sua própria conta da Cloudflare

Um projeto na conta Cloudflare do dono [recebe o deploy do wrangler](/pt-br/cli/deploy/#projetos-na-sua-própria-conta-da-cloudflare), então as contagens do upload são `null` e no lugar vem a versão do wrangler:

```json
{
  "ok": true,
  "instanceUrl": "https://app.bohr.io",
  "url": "https://feature-new-menu-my-site.acme.workers.dev",
  "deploymentId": "…",
  "project": { "id": "p8b2m4c6d1ef", "name": "my-site" },
  "branch": "feature/new-menu",
  "production": false,
  "mode": "byo",
  "versionId": "…",
  "previewUrl": "https://1a2b3c4d-my-site.acme.workers.dev",
  "workerName": "my-site",
  "commitSha": "…",
  "files": null,
  "bytes": null,
  "uploadedFiles": null,
  "uploadedBytes": null,
  "modules": null
}
```

| Campo | Descrição |
| --- | --- |
| `url` | A URL do alias de uma homologação (senão a URL de preview da versão), ou o endereço da produção. `null` para uma homologação de um Worker sem URLs de preview |
| `deploymentId` | O registro do deploy na bohr, ou `null` se não foi possível registrá-lo (o deploy foi feito mesmo assim) |
| `versionId` | A versão do Worker que o wrangler enviou ou publicou |
| `previewUrl` | A URL de preview da própria versão, quando o wrangler imprimiu uma |
| `workerName` | O Worker que recebeu o deploy |
| `commitSha` | O commit publicado, ou `null` quando a árvore de trabalho tinha mudanças não commitadas (tag `bohr-local`) |

## bohr projects

```json
{
  "ok": true,
  "instanceUrl": "https://app.bohr.io",
  "projects": [
    {
      "id": "p3k9x0a7qd2m",
      "name": "my-site",
      "repository": "acme/my-site",
      "productionBranch": "main",
      "mode": "managed",
      "status": "active",
      "role": "owner",
      "productionUrl": "https://my-site-acme.bohr.io",
      "hostnames": [
        { "hostname": "my-site-acme.bohr.io", "branch": "main", "isProduction": true, "status": "live" }
      ]
    }
  ]
}
```

| Campo | Valores |
| --- | --- |
| `mode` | `managed`: a bohr hospeda. `byo`: a conta Cloudflare do dono (só os donos podem fazer `bohr deploy` dele). |
| `status` | `active`, `migrating` ou `suspended` |
| `role` | `owner` (pode fazer deploy de produção) ou `member` |
| `hostnames[].status` | `live`, ou `pending` enquanto a bohr v1 ainda serve o endereço |

## bohr whoami

```json
{
  "ok": true,
  "instanceUrl": "https://app.bohr.io",
  "user": { "id": "u_…", "name": "Ada Lovelace", "email": "ada@example.com" },
  "token": {
    "id": "tok_…",
    "name": "deploy agent",
    "projects": ["p3k9x0a7qd2m"],
    "expiresAt": "2027-01-10T12:00:00.000Z",
    "source": "BOHR_TOKEN"
  }
}
```

`token.projects` é `null` para um token que alcança todos os seus projetos; `source` é `BOHR_TOKEN` ou `bohr login`.

## Outros comandos

| Comando | Campos depois de `"ok": true` |
| --- | --- |
| `bohr link` | `instanceUrl`, `project` (como em `projects`), `path` (o arquivo escrito) |
| `bohr open` | `instanceUrl`, `url`, `project` (`{ id, name }`), `branch` |
| `bohr login` | `instanceUrl`, `user` |
| `bohr logout` | `instanceUrl`, `signedOut` (`false` quando não havia login) |

## Como ler a saída

```sh
out=$(bohr deploy --json)
status=$?
if [ "$status" -eq 0 ]; then
  echo "Deployed to $(echo "$out" | jq -r .url)"
else
  echo "Failed: $(echo "$out" | jq -r .error.code)" >&2
fi
```
