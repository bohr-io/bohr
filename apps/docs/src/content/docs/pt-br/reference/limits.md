---
title: Limites
description: Todos os limites de tamanho, tempo e quantidade da bohr, num só lugar.
sidebar:
  order: 3
---

## O agente

| Limite | Valor |
| --- | --- |
| Orçamento por pedido | US$5 por padrão; definido pelo dono (de 0,10 a 1000, no painel ou no Telegram) |
| Máximo de turnos por pedido | 200 por padrão; de 1 a 1000 |
| Tempo de execução por pedido | 2 horas |
| Tamanho do pedido | 20.000 caracteres |
| Pedidos esperando | 5 por membro; um roda de cada vez por projeto |
| Perguntas do agente | Até 8 opções |
| Início da homologação | O servidor de desenvolvimento precisa aceitar conexões em até 3 minutos; o `install`, em até 15 minutos |
| Porta reservada | 4840 (o servidor de controle do agente) |

## Deploys

| Limite | Valor |
| --- | --- |
| Tamanho de arquivo estático | 25 MiB por arquivo (Cloudflare). Projetos migrados da v1 pulam arquivos de 24 MiB ou mais. |
| `_redirects`, `_headers` | 256 KiB cada (projetos que a bohr hospeda) |
| Workflow de deploy | 30 minutos por execução; uma execução de cada vez por repositório |
| Comandos do `.bohr/deploy.json` | Uma linha, até 500 caracteres, sem `${{ }}` |
| `secrets` do `.bohr/deploy.json` | Até 50 nomes |
| Comandos do `.bohr/preview.json` | Até 1000 caracteres |
| Sessões de deploy (CLI e action) | Vencem depois de 2 horas |
| Branches de homologação que um token cria | 20 por projeto hospedado pela bohr, contando as homologações que ele já tem; um branch que já tem homologação continua recebendo deploy |
| Projetos por repositório | Um |

## Contas e acesso

| Limite | Valor |
| --- | --- |
| Sessão no painel | 30 dias |
| Código de login por e-mail | 6 dígitos, válido por 10 minutos, 5 tentativas |
| Código do `bohr login` | Válido por 10 minutos |
| Código de convite de projeto | Uso único, válido por 24 horas |
| Tokens por usuário | 50 |
| Validade do token | 30, 90 ou 365 dias, ou nunca |
| Comando de orçamento no Telegram | De 0,10 a 1000 (US$) |

## Projetos que a bohr hospeda

Só static assets, `vars` (strings) e secrets; nenhum outro binding e nenhum cron trigger. Veja [Configuração do wrangler](/pt-br/deploys/wrangler-config/#projetos-hospedados-pela-bohr).
