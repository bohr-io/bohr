---
title: Configurações do projeto
description: As páginas Geral, Agente e Hospedagem das configurações de um projeto.
sidebar:
  order: 4
---

**Configurações** tem um menu próprio: **Geral**, **Domínios**, **Variáveis de ambiente**, **Autenticação**, **Agente** e **Hospedagem**. Os membros podem ler; só o dono muda.

- [Domínios](/pt-br/projects/domains/)
- [Variáveis de ambiente](/pt-br/projects/variables/)
- [Autenticação](/pt-br/projects/password-protection/)

## Geral

Os dados do projeto nesta instância:

| Campo | |
| --- | --- |
| **Nome** | O nome do projeto na bohr |
| **Repositório** | `owner/name` no GitHub |
| **Branch de produção** | As mudanças aprovadas são mescladas aqui, e o deploy de produção parte dele |
| **Endereço de produção** | O endereço do site, ou *Ainda não publicado* |
| **Hospedagem** | **Sua conta da Cloudflare**, ou **Hospedado pela bohr** para projetos migrados da v1 |
| **Agente** | Se o agente está ligado |
| **ID do projeto** | O id que a [CLI](/pt-br/cli/commands/) e a API usam, como `p3k9x0a7qd2m` |

O fim desta página tem a [Zona de perigo](/pt-br/projects/delete/).

## Agente

| Configuração | |
| --- | --- |
| **Modelo** | O modelo que o agente usa neste projeto, no lugar do escolhido nas configurações da conta |
| **Orçamento por pedido (US$)** | O agente para quando o custo de um pedido chega a este valor. Padrão: 5. |
| **Máximo de turnos** | Quantas rodadas o agente pode fazer em um pedido, de 1 a 1000. Padrão: 200. |
| **Idioma do agente** | Idioma das respostas do agente e do bot do projeto: Português, English ou Español |

**Telegram** mostra o bot do projeto (**Abrir no Telegram**) ou deixa o dono conectar um com um token do BotFather. Veja [Telegram](/pt-br/agent/telegram/).

**Provedor e chave** ficam nas configurações da sua conta e valem para todos os seus projetos: **Abrir as configurações do agente** ([Provedores de modelo](/pt-br/agent/providers/)).

## Hospedagem

- **Na sua conta da Cloudflare**: o site, o agente e a homologação do projeto rodam na sua conta da Cloudflare. Não há nada a fazer.
- **Hospedado pela bohr**: um projeto migrado da bohr v1, ainda na conta da Cloudflare da bohr. Esta página permite movê-lo para a sua própria conta. Veja [Mover para a sua conta da Cloudflare](/pt-br/migrating-from-v1/move-to-your-cloudflare/).
