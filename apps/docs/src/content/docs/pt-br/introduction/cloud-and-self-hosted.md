---
title: bohr.io Cloud ou auto-hospedada
description: As duas formas de rodar a bohr, o que cada uma inclui e pelo que você paga.
sidebar:
  order: 2
---

A bohr é open source (MIT). Você pode rodar a **instância** (o painel, a API e o cofre de credenciais) por conta própria, ou usar a que a bohr roda para você em [app.bohr.io](https://app.bohr.io). Em qualquer caso, os seus sites fazem deploy na sua própria conta da Cloudflare.

| | bohr.io Cloud | Auto-hospedada |
| --- | --- | --- |
| Quem roda a instância | A bohr | Você, na sua conta da Cloudflare |
| Endereço | `https://app.bohr.io` | O endereço do seu Worker ou o seu domínio |
| Preço da instância | US$20/mês por conta ou organização | Grátis |
| Onde os projetos rodam | Na sua conta da Cloudflare (quando ela não pode rodar Containers, o agente roda na da bohr) | Na conta da Cloudflare de cada usuário |
| Recursos | Todos | Todos |
| Usuários e projetos | Por assinatura | Ilimitados |
| Telemetria | Nada é enviado | Desligada, a menos que um admin a ligue ([detalhes](/pt-br/self-hosting/telemetry/)) |

## O que você paga

Nas duas, a infraestrutura é paga direto aos provedores, nunca pela bohr:

| Provedor | O que cobra |
| --- | --- |
| Cloudflare | O que os seus sites usarem em produção; o plano gratuito basta para muitos sites. Quando o sandbox do agente (um Container) roda na sua conta: o plano **Workers Paid** (US$5/mês) e o tempo de Container enquanto o agente trabalha (um container `standard-1` custa centavos por hora e dorme quando está ocioso). Na auto-hospedada, o agente sempre roda na sua conta; no bohr.io Cloud, só quando a sua conta pode rodar Containers (Workers Paid, e Containers: Edit no token). |
| O seu provedor de modelo | Os tokens do agente, com a sua chave da API da Anthropic ou de um provedor compatível. Com uma assinatura Claude Pro ou Max, o uso conta na sua assinatura. |
| GitHub | Nada a mais: minutos do Actions para as execuções de deploy, dentro do seu plano. |

Cada pedido tem um limite de gasto (US$5 por padrão), que você pode mudar por projeto. Veja [Custos e limites](/pt-br/agent/costs-and-limits/).

## bohr.io Cloud

- Nada para instalar: entre em [app.bohr.io](https://app.bohr.io), assine e conecte as suas contas.
- Uma assinatura por conta pessoal, e uma por [organização](/pt-br/organizations/overview/), paga por um dos admins dela. Os membros de uma organização não precisam de assinatura própria para trabalhar nos projetos dela.
- A cobrança é feita pela Stripe. Veja [Assinatura](/pt-br/billing/subscription/).
- Uma conta gratuita da Cloudflare basta. Quando ela não pode rodar Containers, o agente de cada projeto roda na conta da Cloudflare da bohr, coberto pela assinatura; os seus sites continuam fazendo deploy na sua conta. Veja [Onde o agente roda](/pt-br/getting-started/connect-cloudflare/#onde-o-agente-roda).

## Auto-hospedada

- Faça o deploy da instância com o botão **Deploy to Cloudflare** ou com o `wrangler`, e depois crie o app do GitHub dela em `/setup`. Veja [Auto-hospedagem](/pt-br/self-hosting/overview/).
- A instância em si cabe no plano gratuito da Cloudflare para começar. O agente precisa do Workers Paid na conta onde rodam os projetos de cada usuário; sem ele, os projetos continuam fazendo deploy, sem o agente.
- Você guarda a chave mestra do cofre de credenciais e decide quem pode entrar.

:::note
Quem roda uma instância guarda os tokens da Cloudflare dos usuários dela (criptografados) e a chave do app do GitHub. Use uma instância em que você confia: o bohr.io Cloud, ou a sua.
:::
