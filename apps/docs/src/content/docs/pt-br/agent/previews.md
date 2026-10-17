---
title: A homologação
description: Revise as mudanças do agente na homologação e depois aprove para a produção ou descarte.
sidebar:
  order: 3
---

A **homologação** é o seu site rodando a partir do branch `homolog`, onde o agente faz commit do trabalho dele. Ela junta as mudanças de todos os pedidos concluídos até alguém aprovar ou descartar.

## O estado dela

O projeto mostra a homologação em um de três estados:

| Estado | Significado |
| --- | --- |
| **Igual à produção** | `homolog` é igual à produção. Nada para revisar. |
| **Mudanças para revisar** | O agente fez push de mudanças sobre as quais ninguém decidiu ainda. Cada push é uma nova **versão** (1, 2, 3…). |
| **Publicando** | Alguém aprovou; a bohr está fazendo o merge e o GitHub Actions está fazendo o deploy. |

## Revisando

Use **Ver a homologação** na Visão geral ou no chat, ou escolha **Homologação** no seletor da visualização do site em tela cheia (abrir o **Chat** ali muda para ela):

- Ao lado do seletor, *Igual à produção* ou *Com 2 alterações* (passe o mouse para ver o que mudou).
- Troque entre **Computador**, **Tablet** e **Celular**, ou abra numa nova aba.
- O cartão da homologação na Visão geral lista o que o agente fez, com **Aprovar e publicar** e **Descartar**.
- **Ver as mudanças no GitHub**, no chat, abre o diff exatamente do commit que a aprovação publica.

O chat nunca mostra o endereço da homologação: no Telegram, ela abre pelo botão **🔎 Ver a homologação**.

O endereço da homologação é público, mas não listado: um nome `workers.dev` impossível de adivinhar, marcado como `noindex` para os buscadores. Compartilhe com quem precisa revisar.

A homologação é o **servidor de desenvolvimento** do projeto rodando no sandbox do agente, como configurado em [`.bohr/preview.json`](/pt-br/deploys/preview-json/). O sandbox dorme quando está ocioso: a primeira visita depois de um tempo mostra *"A homologação está iniciando. Esta página recarrega sozinha."* enquanto ele instala e inicia de novo.

## Aprovar e publicar

Qualquer membro pode aprovar. **Aprovar e publicar**:

1. abre (ou reaproveita) um pull request de `homolog` para o branch de produção;
2. faz squash merge dele **só se o head ainda for a versão que você revisou**, para que mudanças enviadas depois da sua revisão não passem junto;
3. redefine `homolog` para o merge, e o próximo pedido começa uma conversa nova;
4. o GitHub Actions faz o deploy da produção. O chat diz *Produção atualizada* quando a execução termina, ou *O deploy de produção falhou* com um link para a execução.

Você não pode decidir enquanto um pedido está rodando (*"Aguarde o pedido em andamento terminar antes de decidir."*). Um pedido que termina enquanto uma aprovação está publicando espera a próxima aprovação.

## Descartar

**Descartar** (confirme em *Descartar as mudanças?*) redefine `homolog` para a produção. As mudanças que não foram publicadas se perdem, e o próximo pedido começa uma conversa nova.

## Aprovando pelo Telegram

O bot do projeto manda os mesmos botões, presos à versão com que foram enviados. Veja [Telegram](/pt-br/agent/telegram/).
