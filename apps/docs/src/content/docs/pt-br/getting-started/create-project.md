---
title: Criar um projeto a partir de um repositório
description: Transforme um dos seus repositórios do GitHub em um projeto da bohr.
sidebar:
  order: 4
---

Um **projeto** é um repositório, um site de produção e um agente. Para criar um, clique em **Novo projeto** na barra lateral.

## 1. Escolha o repositório

1. Em **Como começar**, mantenha **Um repositório meu**.
2. Busque na lista pelo nome ou pela organização e escolha o repositório. Os repositórios privados mostram o selo **Privado**.
3. Confira os dois campos:
   - **Nome do projeto**: como o projeto aparece na bohr.
   - **Branch de produção**: as mudanças aprovadas são mescladas neste branch, e o deploy de produção parte dele. O padrão é o branch padrão do repositório.
4. Clique em **Criar o projeto**.

O repositório que você quer não aparece? Veja [Dar acesso a mais repositórios](/pt-br/getting-started/install-github-app/#dar-acesso-a-mais-repositórios).

:::note[bohr.io Cloud]
Criar projetos exige uma assinatura ativa. Sem ela, o painel mostra *"Para criar projetos no bohr.io Cloud, você precisa de uma assinatura ativa."* com um link para assinar.
:::

## 2. Configuração

A bohr cria, na sua conta da Cloudflare:

- o **Worker do projeto**, com a fila de pedidos, os membros e o chat;
- o **sandbox do agente**, um Container que dorme quando está ocioso;
- o **Worker da homologação**, um endereço `workers.dev` não listado que mostra o branch `homolog`.

O painel mostra o progresso (*Criando o Worker do projeto*, *Preparando o sandbox do agente*, *Ligando a homologação*, *Quase lá*). Costuma levar de um a três minutos; mantenha a página aberta.

Se der errado, o painel mostra *"A configuração do projeto falhou"* com o motivo e uma forma de tentar de novo. As causas mais comuns estão em [Solução de problemas](/pt-br/reference/troubleshooting/#configuração-do-projeto).

## 3. Bot do Telegram (opcional)

A bohr oferece criar um **bot do projeto** no Telegram, para que você e a sua equipe peçam mudanças e aprovem publicações pelo Telegram. Siga os passos (BotFather, `/newbot`, colar o token) ou clique em **Pular e abrir o projeto**. Você pode conectar um bot depois em **Configurações › Agente**. Veja [Telegram](/pt-br/agent/telegram/).

## 4. O agente prepara o repositório

Assim que o projeto fica pronto e o seu [provedor de modelo](/pt-br/agent/providers/) está configurado, o agente começa a **preparar o repositório** sozinho. Continue em [Primeiro deploy](/pt-br/getting-started/first-deploy/).

## Projetos em uma organização

Para criar o projeto em uma organização, troque para ela primeiro (menu de contexto no topo do painel) e clique em **Novo projeto** ali. O projeto roda na conta da Cloudflare da organização e usa as configurações de agente dela, não importa quem o crie. Veja [Organizações](/pt-br/organizations/overview/).
