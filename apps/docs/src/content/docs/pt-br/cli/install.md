---
title: Instalar a CLI
description: Instale a CLI do bohr (pacote npm bohr) ou rode com npx.
sidebar:
  order: 1
---

A **CLI do bohr** faz deploy de projetos da bohr pelo seu terminal, por scripts, por CI e por agentes de IA de programação. É o mesmo código que roda dentro da GitHub Action [`bohr-io/deploy-action`](/pt-br/github-action/reference/).

Ela precisa do **Node.js 20 ou mais recente**.

## Rodar com npx

Sem instalar nada; sempre a versão mais recente:

```sh
npx bohr@latest --version
npx bohr@latest deploy
```

## Instalar globalmente

```sh
npm install --global bohr
bohr --version
```

Atualize com `npm install --global bohr@latest`.

## Como dependência do projeto

```sh
npm install --save-dev bohr
npx bohr deploy
```

## Primeiros passos

```sh
bohr login      # uma vez por computador: aprove no navegador
bohr projects   # os projetos dos quais você pode fazer deploy
bohr deploy     # faz o build e o deploy de uma homologação do branch atual
```

## Ajuda

```sh
bohr --help             # todos os comandos, opções globais, códigos de saída
bohr deploy --help      # as opções de um comando
bohr help deploy        # o mesmo
```

:::caution[bohr v1]
Esta é a CLI da bohr v2 (versão 4.x no npm: as versões 2.x e 3.x de lá são de um pacote de 2016 sem relação). Num repositório que ainda está na bohr v1, ela repassa o comando, sem mudanças, para a CLI da bohr v1 (`bohr@1.0.577`), então os workflows da v1 que rodam `npx bohr@latest deploy` continuam fazendo deploy como antes; o mesmo vale para comandos da bohr v1 como `bohr dev`. Veja [Migrar da bohr v1](/pt-br/migrating-from-v1/overview/).
:::

:::note[Projetos na sua própria conta da Cloudflare]
O `bohr deploy` publica projetos que **a bohr hospeda** (projetos migrados da bohr v1) e, desde a CLI 4.1.0, projetos na sua própria conta da Cloudflare, dos quais só os donos podem fazer deploy pela CLI: o wrangler faz o deploy com a conexão da Cloudflare do dono. Veja [Projetos na sua própria conta da Cloudflare](/pt-br/cli/deploy/#projetos-na-sua-própria-conta-da-cloudflare). Os outros comandos funcionam com todos os projetos.
:::
