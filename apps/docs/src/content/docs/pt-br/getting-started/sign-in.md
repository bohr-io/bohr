---
title: Entrar
description: Entre na bohr com o GitHub ou com um código enviado por e-mail e siga o assistente de Primeiros passos.
sidebar:
  order: 1
---

Abra a instância: [app.bohr.io](https://app.bohr.io) para o bohr.io Cloud, ou o endereço da sua própria instância.

## Com o GitHub

Clique em **Entrar com GitHub** e autorize a bohr. O seu nome e o seu e-mail vêm do GitHub.

## Com um código por e-mail

1. Digite o seu e-mail e clique em **Receber código por e-mail**.
2. A bohr envia um **código de 6 dígitos**, válido por 10 minutos.
3. Digite o código e clique em **Entrar**.

Um código permite 5 tentativas. Se você pedir códigos demais, a bohr responde *"Muitas tentativas. Aguarde alguns minutos e tente de novo."*

:::note
Em uma instância auto-hospedada, a entrada por e-mail só aparece quando o administrador a configurou ([como](/pt-br/self-hosting/optional-features/#login-com-um-código-por-e-mail)). A primeira pessoa que entra em uma instância nova vira a administradora dela.
:::

A sua sessão dura 30 dias naquele navegador. **Conta › Sair da conta** encerra a sessão. Você pode adicionar ou remover formas de entrar depois, em [Contas conectadas](/pt-br/account/connections/).

## O assistente de Primeiros passos

Depois da primeira entrada, o painel abre **Primeiros passos**. Ele pede só o que todo usuário configura uma vez:

| Passo | O que você faz |
| --- | --- |
| **Assinatura** | Só no bohr.io Cloud: clique em **Assinar**, pague na Stripe e volte. Veja [Assinatura](/pt-br/billing/subscription/). |
| **Cloudflare** | Crie um token de API e cole. Veja [Conectar a Cloudflare](/pt-br/getting-started/connect-cloudflare/). |
| **GitHub** | Instale o app do GitHub da bohr nos seus repositórios. Veja [Instalar o app do GitHub](/pt-br/getting-started/install-github-app/). |

Quando aparecer **Tudo pronto!**, clique em **Novo projeto**, ou antes em **Configurar o agente** se você ainda não escolheu um provedor de modelo ([Provedores de modelo](/pt-br/agent/providers/)).

:::tip
Vai trabalhar só em projetos de uma [organização](/pt-br/organizations/overview/) da qual você faz parte? Você não precisa desta configuração: os admins da organização já conectaram a assinatura, a conta da Cloudflare e o agente dela. Troque para a organização no menu de contexto no topo do painel.
:::
