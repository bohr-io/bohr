---
title: Custos e limites
description: Quanto custa cada pedido, os limites de orçamento e de turnos, e como mudá-los.
sidebar:
  order: 7
---

## Custo de cada pedido

O agente gasta tokens do modelo aos preços do seu provedor, e você paga isso ao seu provedor, não à bohr; com uma [assinatura Claude](/pt-br/agent/providers/#assinatura-claude-promax), eles fazem parte dela. O chat nunca fala de custo: o console do seu provedor mostra quanto você gastou.

O tempo de Container é cobrado pela Cloudflare da conta que roda o projeto: o sandbox roda enquanto o agente trabalha e enquanto a homologação está sendo visitada, e depois dorme.

## Limites por pedido

| Limite | Padrão | Onde mudar |
| --- | --- | --- |
| **Orçamento por pedido (US$)** | 5 | **Configurações › Agente** (dono), ou `/orcamento` no Telegram: de 0,10 a 1000. |
| **Máximo de turnos** | 200 | **Configurações › Agente** (dono): de 1 a 1000. Um turno é uma rodada de trabalho do agente. |
| Tempo de execução | 2 horas | Fixo |
| Tamanho do pedido | 20.000 caracteres | Fixo |
| Pedidos esperando | 5 por membro | Fixo |

Quando um pedido atinge o orçamento, ele para e nada é enviado: *"o pedido chegou ao limite por pedido antes de o trabalho terminar. O dono pode aumentar esse limite nas configurações do agente."* Com uma assinatura Claude, o orçamento é um limite de segurança estimado a preços da API; nada é cobrado à parte.

## Mantendo os custos baixos

- Peça uma coisa de cada vez e seja específico (veja as [Dicas](/pt-br/agent/tips/)).
- Diminua o **Esforço** em [Provedores de modelo](/pt-br/agent/providers/) para projetos simples.
- Escolha um modelo menor para um projeto em **Configurações › Agente › Modelo**.
- Aprove ou descarte quando terminar: os pedidos seguintes em uma homologação longa carregam a conversa inteira.
