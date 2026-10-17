---
title: Visão geral da auto-hospedagem
description: Rode a sua própria instância da bohr na sua conta da Cloudflare, e quanto isso custa.
sidebar:
  order: 1
---

A bohr é open source (MIT). Uma **instância auto-hospedada** é o mesmo software do bohr.io Cloud, rodando na sua conta da Cloudflare: um Worker com a API, o onboarding (web e Telegram), o cofre de credenciais e o painel web, mais um banco de dados D1.

Os projetos não rodam na instância. Cada um roda na conta da Cloudflare do seu dono, que a instância prepara com o token da API do dono. Instale uma instância para você, para a sua equipe ou para os seus clientes; ela tem usuários e projetos ilimitados e todos os recursos.

## O que cada pessoa precisa

| Quem | Precisa de |
| --- | --- |
| Quem hospeda a instância | Uma conta da Cloudflare com Workers, D1 e Workflows (o plano gratuito basta para começar) e uma conta do GitHub para ser dona do app do GitHub da instância |
| Cada usuário | Uma conta da Cloudflare, uma conta do GitHub e um provedor de modelo. O agente precisa do Workers Paid na conta da Cloudflare (o sandbox dele é um Container); sem ele, os projetos continuam fazendo deploy, sem o agente. O Telegram é opcional. |

## Custos

| Conta | Paga por |
| --- | --- |
| A da instância | Workers, D1 e Workflows. Uma instância pequena cabe no plano gratuito. O Workers Paid (US$5/mês) só é necessário para o [container de login](/pt-br/self-hosting/optional-features/#um-container-de-login-dedicado) opcional. |
| A Cloudflare de cada usuário | O que o projeto usa em produção e, para o agente, o Workers Paid (US$5/mês) e o sandbox enquanto o agente trabalha (um container `standard-1` custa centavos por hora e dorme quando ocioso) |
| O provedor de modelo de cada usuário | Os tokens do agente. Todo pedido tem um orçamento (US$5 por padrão, definido por projeto). |

## Passos

1. [Faça o deploy da instância](/pt-br/self-hosting/deploy-instance/) com o botão Deploy to Cloudflare ou com o wrangler.
2. [Crie o app do GitHub dela](/pt-br/self-hosting/github-app/) em `/setup`.
3. Opcional: [o bot da plataforma, o login por e-mail e o container de login](/pt-br/self-hosting/optional-features/).
4. Entre: a primeira pessoa vira o [administrador](/pt-br/self-hosting/administration/).
5. Os usuários passam pelo [Primeiros passos](/pt-br/getting-started/sign-in/) como no bohr.io Cloud, sem o passo da assinatura.

## Confiança

A instância guarda os tokens da Cloudflare dos usuários e a chave privada do app do GitHub dela, criptografados com uma chave mestra que fica com você. Os usuários precisam confiar em quem hospeda a instância. Todo uso de uma credencial guardada fica registrado no log de auditoria da instância. Veja [Modelo de segurança](/pt-br/reference/security/).
