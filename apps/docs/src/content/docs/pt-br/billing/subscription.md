---
title: Assinatura
description: A assinatura do bohr.io Cloud, o que ela inclui e como gerenciá-la.
sidebar:
  order: 1
---

**O bohr.io Cloud custa US$20 por mês** por conta pessoal ou organização. A bohr roda e mantém a instância para você (o painel, o bot do Telegram, o cofre de credenciais), e os seus projetos rodam na sua própria conta da Cloudflare. A cobrança é feita pela Stripe.

Instâncias self-hosted não têm assinatura: *"Esta instância não cobra assinatura."*

## O que está incluído

- A instância da bohr em [app.bohr.io](https://app.bohr.io), com todos os recursos: o agente, as homologações, as aprovações, as versões, os membros, as organizações, as variáveis, a proteção por senha, os domínios, a CLI e a GitHub Action.
- O bot da plataforma no Telegram e a entrada por e-mail.
- Quando a sua conta da Cloudflare não pode rodar Containers (no plano gratuito, por exemplo), o runtime do agente de cada projeto (o Worker dele, o sandbox do agente e a homologação) na conta da Cloudflare da bohr. Veja [Onde o agente roda](/pt-br/getting-started/connect-cloudflare/#onde-o-agente-roda).

## O que não está incluído

A infraestrutura é paga direto aos provedores:

- **Cloudflare**: o que os seus sites consomem. Uma conta gratuita basta. Se o agente roda na sua conta, também o plano Workers Paid (US$5/mês) e o tempo de container enquanto o agente trabalha.
- **O seu provedor do modelo**: os tokens do agente, ou a sua assinatura Claude.

## Assinar

- Em **Primeiros passos**, na etapa **Assinatura**: clique em **Assinar**, pague na Stripe e volte. O painel confirma o pagamento (*"Pagamento recebido. Estamos confirmando a assinatura com a Stripe…"*). Se ela ainda não aparecer como ativa, aguarde um pouco e clique em **Verificar de novo**.
- Ou em **Conta › Assinatura › Ver a assinatura › Assinar o bohr.io Cloud**.
- Uma organização assina durante a configuração dela, com o pagamento feito por um dos admins. Veja [Configurações e cobrança da organização](/pt-br/organizations/settings-and-billing/#assinatura-bohrio-cloud).

Criar projetos no bohr.io Cloud exige uma assinatura ativa. Códigos promocionais são aceitos no checkout.

## Gerenciar

**Assinatura** (a partir de **Conta**) mostra a **Situação**, o **Plano** e a **Próxima cobrança** (ou **Válida até**, depois de cancelada). **Gerenciar na Stripe** abre o portal da Stripe para o cartão, as faturas e o cancelamento.

| Situação | Significado |
| --- | --- |
| **Ativa** | Paga e em dia |
| **Em período de teste** | Num período de teste |
| **Pagamento atrasado** | Um pagamento falhou; os projetos continuam funcionando enquanto a Stripe tenta de novo |
| **Cancelada**, **Expirada**, **Não paga**, **Pagamento incompleto**, **Pausada** | Não ativa: você não pode criar projetos |
| **Vinda da versão anterior, em verificação** | Uma assinatura trazida da bohr v1 |

## Clientes da bohr v1

Clientes que pagavam pela bohr v1 mantêm **o preço do plano deles** (*Preço da versão anterior da bohr*). Os projetos deles ficam hospedados pela bohr até que eles os movam. Veja [Migrar da bohr v1](/pt-br/migrating-from-v1/overview/).
