---
title: O seu primeiro pedido
description: Peça uma mudança ao agente, revise na homologação e publique.
sidebar:
  order: 7
---

Com o repositório preparado, peça algo pequeno para ver o ciclo inteiro.

1. Abra o projeto e vá em **Agente** (ou abra a visualização do site na **Visão geral** e clique em **Chat**).
2. Em **Peça uma mudança…**, escreva o que você quer, por exemplo:

   > Mude o título da página inicial para "Pão fresquinho toda manhã" e deixe o botão principal laranja.

3. Aperte <kbd>Enter</kbd> para enviar (<kbd>Shift</kbd> + <kbd>Enter</kbd> quebra a linha).
4. O chat mostra **O agente está trabalhando** com linhas curtas de status (*Editando src/pages/index.astro*, *Executando: npm run build*…). Você pode clicar em **Cancelar o pedido** enquanto ele roda.
5. Quando termina, o agente escreve um resumo do que mudou e do que conferir, e um cartão **Homologação pronta · versão 1** com:
   - **Ver a homologação**: o site com a mudança, no endereço da homologação;
   - **Ver as mudanças no GitHub**: o diff exato que você está aprovando;
   - **Aprovar e publicar** e **Descartar**.
6. Não ficou bem como queria? É só mandar outra mensagem, como *"Deixe o botão um pouco maior"*. O agente continua a mesma conversa e a homologação ganha uma nova versão.
7. Clique em **Aprovar e publicar**. A bohr faz o merge da mudança na produção e o GitHub Actions faz o deploy. O chat avisa quando a produção é atualizada.

Pronto. A seguir:

- [Dicas para bons pedidos](/pt-br/agent/tips/)
- [A homologação, aprovar e descartar](/pt-br/agent/previews/)
- [Peça pelo Telegram](/pt-br/agent/telegram/)
- [Convide a sua equipe](/pt-br/projects/members/)
