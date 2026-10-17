---
title: Referência da bohr-io/deploy-action
description: Inputs, outputs e modos da GitHub Action bohr-io/deploy-action@v1.
sidebar:
  order: 1
---

A `bohr-io/deploy-action@v1` faz deploy de projetos da bohr a partir do GitHub Actions. Ela é uma camada fina que roda a [CLI do bohr](/pt-br/cli/install/) mais recente (`npx --yes bohr@latest action`) com os inputs abaixo. Ela entra na bohr com o **token OIDC do GitHub** da execução, então o job precisa de:

```yaml
permissions:
  contents: read
  id-token: write
```

Ela tem três modos:

| Modo | Input | Usado por | O que faz |
| --- | --- | --- | --- |
| **Deploy** (padrão) | — | Projetos que a bohr hospeda | Envia o Worker construído e os assets estáticos para a hospedagem da bohr, para o branch que recebeu o push |
| **Credenciais** | `credentials: "true"` | Projetos na sua própria conta Cloudflare (no workflow que a bohr escreve) | Obtém as credenciais da Cloudflare e as variáveis de build para o `wrangler deploy`; não faz deploy de nada |
| **Plano de build** | `build-plan: "true"` | Projetos migrados da bohr v1 que mantêm o workflow da v1 | Obtém o plano de build do projeto; não faz deploy de nada |

Raramente você mesmo adiciona a action: a bohr a escreve no [`bohr-deploy.yml`](/pt-br/deploys/deploy-workflow/) dos projetos na sua conta, e os projetos migrados a rodam pelo workflow da v1.

## Inputs

| Input | Padrão | Descrição |
| --- | --- | --- |
| `instance-url` | `https://app.bohr.io` | URL base da instância da bohr que gerencia o projeto. Precisa usar `https`. |
| `working-directory` | `.` | Pasta com o `wrangler.jsonc` (ou `wrangler.json`) do projeto, relativa à raiz do repositório. Modo deploy. |
| `credentials` | `false` | `"true"`: só obtém as credenciais de deploy e as variáveis de build de um projeto na conta do dono. |
| `build-plan` | `false` | `"true"`: só prepara o build de um projeto migrado da bohr v1. |
| `phase` | `prepare` | Com `build-plan: "true"`: o passo a rodar. Só existe `prepare`. |

`credentials` e `build-plan` não podem ser `"true"` ao mesmo tempo.

## Outputs

| Output | Modo | Descrição |
| --- | --- | --- |
| `url` | Deploy | URL onde o branch publicado é servido |
| `deployment-id` | Deploy | Identificador do deployment na instância da bohr |
| `cloudflare-api-token` | Credenciais | O token de API da Cloudflare para fazer o deploy (mascarado) |
| `cloudflare-account-id` | Credenciais | A conta Cloudflare onde fazer o deploy (mascarado) |
| `found` | Plano de build | `"true"` quando a bohr tem um plano de build para este repositório, senão `"false"` |
| `node-version` | Plano de build | A versão do Node.js para o `actions/setup-node` |
| `install` | Plano de build | O comando de install (vazio: nenhum) |
| `build` | Plano de build | O comando de build (vazio: nenhum) |
| `live` | Plano de build | `"true"` quando o endereço de produção do projeto já foi para a bohr v2 |

No modo deploy, o job summary mostra a URL e quantos arquivos foram encontrados e enviados.

## Modo deploy

Rode o seu build antes da action: ela faz deploy do que o build escreveu, e não instala dependências nem faz build. Cada branch que recebe push ganha deploy no seu próprio endereço; o branch de produção recebe o endereço principal do projeto.

A action lê `wrangler.json` ou `wrangler.jsonc` em `working-directory`, empacota o `main` com `wrangler deploy --dry-run` (adicione `wrangler` às suas `devDependencies` para fixar a versão) e envia só os arquivos estáticos novos ou alterados. Projetos hospedados suportam assets estáticos, `vars` e secrets: veja [Configuração do wrangler](/pt-br/deploys/wrangler-config/#projetos-hospedados-pela-bohr).

## Modo credenciais

Com `credentials: "true"` a action pede as credenciais à bohr (`POST <instance-url>/api/deploy/credentials` com o token OIDC), mascara todos os valores e então:

- exporta as [variáveis de build](/pt-br/projects/variables/#variáveis-do-build) do projeto (branch de produção) para o ambiente dos steps seguintes, para que o install e o build as vejam;
- define o token e a conta da Cloudflare como outputs do step, para que só o step que os mapeia (o deploy) os receba.

A bohr só responde a execuções de `.github/workflows/bohr-deploy.yml` num `push` (ou `workflow_dispatch`) para o branch de produção do projeto, de um projeto na conta Cloudflare do dono. Ela entrega o token do próprio dono (o seu, ou o da sua organização), nunca o da bohr.

## Modo plano de build

Para repositórios migrados da bohr v1 que mantêm o workflow (`.github/workflows/bohr.yml` rodando `bohr-io/action@main`). A action da bohr v1 chama esta duas vezes: para preparar (`build-plan: "true"`) e depois para fazer o deploy. Nada é escrito no seu repositório. Veja [Migrar da bohr v1](/pt-br/migrating-from-v1/what-changes/).

## Erros

| Erro | Correção |
| --- | --- |
| `Could not get a GitHub OIDC token` | Adicione `permissions: id-token: write` ao workflow ou ao job. Workflows disparados a partir de forks nunca recebem tokens OIDC. |
| `No bohr.io Cloud managed project matches this repository and branch` | Crie ou migre o projeto no painel da bohr, e faça deploy em pushes de branch (não em tags nem pull requests). |
| `could not give the deploy credentials (HTTP 403)` | Modo credenciais: a mensagem diz o motivo. Só o `bohr-deploy.yml` num push para o branch de produção de um projeto na conta do dono recebe as credenciais. |
| `Found wrangler.toml, but this action reads wrangler.jsonc` | Converta a configuração para `wrangler.jsonc`. |
| `… is not supported` | Remova o binding; projetos hospedados suportam assets estáticos, vars e secrets. |
| `The assets directory … does not exist` | Rode o build antes da action, ou corrija `assets.directory`. |
| `Asset too large: …` | Arquivos com mais de 25 MiB não podem ir no deploy: remova o arquivo ou liste-o no `.assetsignore`. |
