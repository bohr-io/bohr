---
title: O que muda para um projeto da v1
description: Como um projeto migrado faz build, deploy e é servido enquanto a bohr o hospeda.
sidebar:
  order: 2
---

## Os deploys continuam funcionando

O workflow da v1 do seu repositório roda o `bohr-io/action` a cada push, como antes. Essa action agora pergunta à bohr v2 como fazer o build do projeto (o **plano de build** dele: a versão do Node.js, os comandos de install e de build e os arquivos gerados de que a bohr v2 precisa), faz o build e o deploy com o [`bohr-io/deploy-action`](/pt-br/github-action/reference/#modo-plano-de-build). O build plan fica na bohr, não no seu repositório.

- **Cada branch que recebe push** ganha deploy no próprio endereço: `<branch>-<repo>-<owner>.bohr.io`. O branch de produção fica com `<repo>-<owner>.bohr.io` e os seus domínios próprios.
- As **variáveis do build** são entregues ao build quando ele roda; gerencie-as em **Configurações › Variáveis de ambiente**. Pull requests nunca as recebem.
- **Os arquivos estáticos são publicados como a v1 publicava**: os arquivos que a v1 deixava de fora (como `node_modules/`, `.github/`, `package.json`, lockfiles e arquivos `.env`) continuam de fora, e arquivos de 24 MiB ou mais são pulados com um aviso, em vez de fazer o deploy falhar.

## O que a hospedagem suporta

Os projetos que a bohr hospeda são Workers com static assets na conta da bohr:

- Static assets, `vars` e secrets ([variáveis do site](/pt-br/projects/variables/)). Outros bindings (D1, KV, R2, Durable Objects…) e cron triggers não estão disponíveis enquanto a bohr hospeda o projeto; [mova-o](/pt-br/migrating-from-v1/move-to-your-cloudflare/) para usá-los.
- A [proteção por senha](/pt-br/projects/password-protection/) é aplicada pela borda da bohr.
- Os domínios continuam como eram na v1. Para mudá-los, mova o projeto para a sua conta.

## O painel

- **Configurações › Hospedagem** mostra **Hospedado pela bohr** e a mudança.
- **Configurações › Domínios** lista os seus domínios como **No ar** ou **Pendente** (*Pendente* enquanto a bohr v1 ainda serve um endereço).
- **Builds** mostra as execuções do seu workflow.
- Sem o agente, o projeto mostra **Só deploys**. **Ativar o agente** adiciona o agente, a homologação e as aprovações; o agente então também roda na conta da bohr, até você mover o projeto.

## A CLI

A CLI da bohr v2 é a `bohr@2`. O seu workflow da v1 não precisa dela. Localmente:

- `bohr deploy` publica uma homologação do branch atual; `bohr deploy --prod` publica a produção (só donos). Veja [bohr deploy](/pt-br/cli/deploy/).
- Enquanto a bohr v1 ainda serve o seu endereço de produção, os deploys de produção vêm do seu workflow (`production_on_v1`); as homologações funcionam.
- Os comandos da v1 (`bohr dev`) e as opções da v1 (`--no-install`, `--show-install`, `--show-build`) não existem mais.
- Num repositório que ainda roda só na bohr v1, a CLI repassa o comando para a CLI da bohr v1, que faz o deploy como sempre fez.
