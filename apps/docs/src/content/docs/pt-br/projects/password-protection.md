---
title: Proteção por senha
description: Peça usuário e senha (Basic Auth) aos visitantes antes de abrirem o site.
sidebar:
  order: 6
---

**Configurações › Autenticação** coloca usuário e senha (HTTP Basic Auth) na frente do seu site de produção. Use para um site que ainda não é público, ou para o site de staging de um cliente.

1. Em **Método**, escolha **Basic Auth** (ou **Nenhum** para desligar a proteção).
2. Em **Usuários**, adicione pelo menos um **Usuário** e **Senha** (**Novo usuário** adiciona mais). Os nomes de usuário não podem ter espaços nem `:`.
3. Opcional: em **URLs liberadas**, adicione caminhos que abrem sem senha (**Nova URL**). Cada caminho começa com `/`: o caminho exato, ou todos os caminhos que começam com ele quando termina com `*` (por exemplo `/api/webhooks/*`).
4. Clique em **Salvar**. A proteção passa a valer em alguns segundos, sem deploy.

Para trocar uma senha, digite uma nova; deixar em branco mantém a atual (*Senha mantida — digite para trocar*). A bohr guarda só hashes PBKDF2-SHA256 com salt, nunca as senhas.

## Como funciona

- **Na sua conta da Cloudflare**: o workflow de deploy da bohr envolve o seu site numa pequena barreira que confere as credenciais. As configurações ficam num secret do seu Worker de produção (`BOHR_SITE_AUTH`), então ligar ou desligar a proteção não exige deploy. A barreira gera `.bohr-gate.mjs` e `wrangler.bohr-gate.json` na hora do deploy; eles nunca vão para o commit.
- **Hospedado pela bohr**: a borda da bohr confere as credenciais antes de o seu Worker rodar.

:::caution[Comandos de deploy próprios]
A barreira só envolve sites publicados com o comando padrão, `npx wrangler deploy`. Se o seu [`.bohr/deploy.json`](/pt-br/deploys/deploy-json/) define um comando `deploy` próprio, o painel mostra *"A proteção não vale para este site"*: a bohr não consegue colocar a proteção na frente dele.
:::

A homologação tem um endereço próprio, não divulgado, e não é coberta por esta configuração. A proteção vale para o site de produção.
