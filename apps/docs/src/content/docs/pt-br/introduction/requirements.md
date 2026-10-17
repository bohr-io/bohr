---
title: O que você precisa
description: As contas e os planos de que cada pessoa precisa para usar a bohr.
sidebar:
  order: 3
---

## Para usar a bohr

| Você precisa de | Por quê |
| --- | --- |
| Uma conta no **GitHub** | O seu código fica nos seus repositórios. A bohr os lê e muda pelo app do GitHub dela, apenas nos repositórios que você escolher. |
| Uma conta na **Cloudflare** | O seu site de produção roda ali, e o Worker de cada projeto, o sandbox do agente (um Container) e a homologação também, quando a conta pode rodar Containers. O plano gratuito serve: no bohr.io Cloud ele basta, e numa instância auto-hospedada o agente precisa do **Workers Paid** ([onde o agente roda](/pt-br/getting-started/connect-cloudflare/#onde-o-agente-roda)). A conta também precisa de um subdomínio `workers.dev`: abra **Workers & Pages** uma vez no painel da Cloudflare para criá-lo. |
| Um **provedor de modelo** para o agente | Uma chave da API da Anthropic, um endpoint compatível com a Messages API da Anthropic (OpenRouter, DeepSeek, Kimi, GLM, um proxy LiteLLM…), ou uma assinatura Claude Pro/Max. Sem um, os projetos continuam fazendo deploy do que chega ao GitHub, mas o agente fica desligado. |
| No bohr.io Cloud: uma **assinatura** | US$20/mês por conta pessoal ou organização. Não é necessária em uma instância auto-hospedada. |
| Opcional: **Telegram** | Para falar com o agente e aprovar publicações pelo celular. O chat web faz tudo sem ele. |

## Para trabalhar no projeto de outra pessoa

Só uma conta na bohr. O dono do projeto [convida você](/pt-br/projects/members/) com um código, ou adiciona você pela [organização](/pt-br/organizations/members/) dele. Os membros usam a conta da Cloudflare e o agente do dono; não precisam de assinatura, conta da Cloudflare nem chave de modelo próprias.

## Projetos suportados

O agente mapeia o seu repositório para a Cloudflare na primeira execução:

| No repositório | Produção | Homologação |
| --- | --- | --- |
| JavaScript/TypeScript ou Python sem Dockerfile | Um Worker com static assets, usando o adaptador oficial do framework para a Cloudflare (OpenNext para Next.js 15.5+, o preset `cloudflare` do Nuxt, `@astrojs/cloudflare`, `@sveltejs/adapter-cloudflare`, React Router ou Remix para Cloudflare). Um site estático simples é só assets. | O servidor de desenvolvimento do framework |
| Um Dockerfile | Um Container atrás de um Worker (precisa do Workers Paid na sua conta) | O servidor de desenvolvimento |
| Postgres | Neon na sua conta, via Hyperdrive | Um branch do Neon |
| Redis | Upstash na sua conta | `redis-server` no sandbox |
| Arquivos gravados no disco local | R2 | Um bucket R2 para a homologação |

Serviços com estado, como volumes, MongoDB ou Elasticsearch, não são suportados; o agente avisa e sugere a alternativa mais próxima. Quando uma mudança move as suas filas ou gravações em disco para serviços da Cloudflare, o agente pergunta antes de fazer.
