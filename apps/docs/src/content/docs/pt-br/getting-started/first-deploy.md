---
title: Primeiro deploy
description: Como o agente prepara o seu repositório e como o seu site chega à produção pela primeira vez.
sidebar:
  order: 6
---

Um projeto novo a partir de um dos seus repositórios não faz deploy de nada até o repositório estar **preparado** para a bohr. O agente faz isso na primeira execução.

## Preparando o repositório

Quando o projeto fica pronto e o seu [provedor de modelo](/pt-br/agent/providers/) está configurado, o agente começa sozinho. No chat, você vê o pedido *"Prepare este repositório para a bohr…"* e o andamento dele. O agente:

1. Inspeciona o repositório e decide como ele roda na Cloudflare: static assets, um Worker, ou um Container atrás de um Worker.
2. Escreve o [`.bohr/preview.json`](/pt-br/deploys/preview-json/), para que a homologação consiga rodar o servidor de desenvolvimento do projeto.
3. Adiciona um `wrangler.jsonc` se o repositório não tiver.
4. Escreve o [`.bohr/deploy.json`](/pt-br/deploys/deploy-json/), a partir do qual a bohr gera o workflow de produção, `.github/workflows/bohr-deploy.yml`.
5. Faz o build de produção passar.
6. Remove os workflows da bohr v1 (`bohr-io/action`), que falham a cada push.
7. Conta o que encontrou, o que mudou e o que não pode ser suportado.

Leva alguns minutos. Enquanto isso, a **Visão geral** do projeto mostra *Preparando o repositório* em **O que falta**.

Ainda sem provedor? O projeto espera: assim que você salva as configurações do agente, o agente prepara todos os projetos que estavam esperando. Você também pode começar à mão com **Preparar o repositório** no chat, ou **Preparar repositório** na lista de pendências.

## Publicando pela primeira vez

A preparação termina como qualquer outro pedido: com uma **homologação** e os botões **Aprovar e publicar** e **Descartar**.

1. Abra a homologação e confira o site.
2. Clique em **Aprovar e publicar**. A bohr abre um pull request de `homolog` para o seu branch de produção e faz o merge.
3. O merge roda o `bohr-deploy.yml` no GitHub Actions. Ele pede à bohr as suas credenciais da Cloudflare na hora da execução, faz o build do site e roda `wrangler deploy` na sua conta.
4. O chat diz *Produção atualizada* quando a execução termina. Acompanhe em [Builds](/pt-br/projects/builds/).

Agora o seu site é um Worker na sua conta da Cloudflare, no endereço `workers.dev` dele. Adicione o seu próprio domínio em [Domínios](/pt-br/projects/domains/).

:::tip
Os projetos de modelo pulam esta etapa: o repositório deles já tem tudo, então o primeiro deploy começa assim que o projeto é criado.
:::

## Quando o agente está desligado

Sem um provedor de modelo, um projeto só publica o que chega ao GitHub: um push para o branch de produção roda o workflow de deploy, se o repositório tiver um. O projeto aparece como **Só deploys** na lista.
