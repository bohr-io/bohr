---
title: Como os deploys funcionam
description: Como um projeto da bohr faz o build e publica na Cloudflare, e os arquivos que descrevem isso.
sidebar:
  order: 1
---

O site de produção de um projeto da bohr é um **Cloudflare Worker com static assets**. O build e a publicação são feitos pelo **GitHub Actions**, a partir do branch de produção, depois de cada mudança aprovada.

```
.bohr/deploy.json ──(a bohr escreve)──▶ .github/workflows/bohr-deploy.yml
                                               │ no push para o branch de produção
                                               ▼
               checkout → setup Node.js → bohr credentials (OIDC) → install → build
                                               │
                                               ▼
                 D1 migrations (se houver) → wrangler deploy → sua conta da Cloudflare
```

## Os arquivos

| Arquivo | Quem escreve | O que diz |
| --- | --- | --- |
| [`.bohr/deploy.json`](/pt-br/deploys/deploy-json/) | O agente (você pode editar) | Como fazer o build de produção: pasta, versão do Node.js, gerenciador de pacotes, comandos de install, build e deploy |
| [`.github/workflows/bohr-deploy.yml`](/pt-br/deploys/deploy-workflow/) | A bohr, a partir de `.bohr/deploy.json` | O workflow do GitHub Actions que roda nos pushes para o branch de produção |
| [`wrangler.jsonc`](/pt-br/deploys/wrangler-config/) | O agente ou você | O Worker: nome, ponto de entrada, static assets, bindings |
| [`.bohr/preview.json`](/pt-br/deploys/preview-json/) | O agente (você pode editar) | Como a homologação roda o servidor de desenvolvimento no sandbox |

## O que dispara um deploy

- **Aprovar uma homologação**: a bohr faz o merge de `homolog` no branch de produção; o push roda o workflow.
- **Reverter**: o revert é mesclado; mesma coisa.
- **Qualquer push para o branch de produção**, feito por você ou por outra ferramenta.
- **`bohr deploy --prod`** pela [CLI](/pt-br/cli/deploy/#projetos-na-sua-própria-conta-da-cloudflare), feito por um dono do projeto.

No GitHub Actions, só o branch de produção faz deploy. A homologação do agente não é um deploy: é o servidor de desenvolvimento no sandbox do agente. Os donos também podem enviar versões de homologação de qualquer branch com o `bohr deploy`; elas nunca mudam a produção.

## Credenciais

Nenhum token da Cloudflare fica guardado no seu repositório. Quando o workflow roda, o primeiro passo da bohr pede à instância da bohr as suas credenciais da Cloudflare e as [variáveis do build](/pt-br/projects/variables/#variáveis-do-build) do projeto, provando quem é com um **token OIDC do GitHub**. A bohr só responde a execuções do `bohr-deploy.yml` num push (ou execução manual) para o branch de produção de um projeto na conta do dono dele. Veja [Modelo de segurança](/pt-br/reference/security/#credenciais-de-deploy).

## O site nunca sai do ar

O `wrangler deploy` envia a nova versão e passa a servi-la num único passo. Se o build ou o deploy falhar, a produção continua servindo a versão anterior, e o chat mostra o link da execução que falhou.

## Projetos hospedados pela bohr

Projetos migrados da bohr v1 fazem deploy de outro jeito: o workflow da v1 continua funcionando e publica na hospedagem da bohr, e cada branch enviado ganha um endereço próprio. Eles também podem ser publicados com a [CLI](/pt-br/cli/deploy/). Veja [Migrar da bohr v1](/pt-br/migrating-from-v1/what-changes/).
