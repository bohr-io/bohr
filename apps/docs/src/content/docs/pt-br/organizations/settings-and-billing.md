---
title: Configurações e cobrança da organização
description: A conta da Cloudflare, o agente e a assinatura de uma organização, e como excluí-la.
sidebar:
  order: 3
---

**Configurações** de uma organização. Só os admins dela as mudam (*"Só os admins da organização mudam as configurações."*).

## Geral

O **Nome** e a foto vêm da organização no GitHub; a página tem um link para ela no **GitHub**.

## Cloudflare

Os projetos da organização rodam nesta conta da Cloudflare. **Conectar uma conta** com um token, como [para você](/pt-br/getting-started/connect-cloudflare/), ou **Conectar outra conta**. Uma conta não pode ser desconectada enquanto projetos da organização rodam nela.

## Agente

O provedor, a chave, o modelo e o esforço do agente em todos os projetos da organização. As mesmas opções das [configurações pessoais](/pt-br/agent/providers/): uma chave da API da Anthropic, um provedor compatível ou uma assinatura Claude. Salvar aplica a todos os projetos prontos da organização; remover desliga o agente em todos eles (os deploys do GitHub continuam funcionando).

## Assinatura (bohr.io Cloud)

Cada organização tem a **própria** assinatura, de US$20/mês, paga por um dos admins com um cliente da organização na Stripe, que nunca se mistura com a assinatura pessoal do admin. Os membros não precisam de assinatura. Os admins assinam pela configuração da organização e a gerenciam (cartão, faturas, cancelamento) em **Gerenciar na Stripe**. Veja [Assinatura](/pt-br/billing/subscription/).

## Quando o app do GitHub é desinstalado

Se alguém desinstala o App da bohr da organização no GitHub, a página diz *"O app do GitHub foi desinstalado"*: os projetos continuam no ar, mas não dá para criar novos nem sincronizar os membros. Clique em **Instalar o app de novo** para resolver.

## Zona de perigo: excluir a organização

**Excluir organização** remove da bohr os projetos dela e tudo o que a bohr criou para eles. Digite o slug da organização para confirmar.

- Os projetos da organização são excluídos (agentes, homologações, bots e rotas da bohr).
- A assinatura da organização é cancelada, e as contas da Cloudflare e o agente são desconectados.
- O app da bohr é desinstalado da organização no GitHub. **Os repositórios não são alterados.**
- Os sites publicados na conta da Cloudflare da organização **continuam no ar**, a menos que você marque **Também apagar os sites publicados na conta da Cloudflare da organização**.
