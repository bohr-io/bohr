---
title: Chat no painel
description: Converse com o agente na página Agente do projeto ou ao lado da visualização do site, acompanhe o trabalho dele e responda às perguntas dele.
sidebar:
  order: 1
---

Todo projeto tem uma conversa com o agente, compartilhada por todos os membros, na web e no [Telegram](/pt-br/agent/telegram/).

## Onde conversar

- **Agente** (menu do projeto): a conversa completa, com as decisões sobre a homologação.
- **Visão geral › visualização do site**: abra o site em tela cheia e clique em **Chat** para conversar com o agente ao lado dele. **Fechar o chat** esconde de novo.

## Enviando um pedido

Digite em **Peça uma mudança…** e aperte <kbd>Enter</kbd> (<kbd>Shift</kbd> + <kbd>Enter</kbd> para uma nova linha). Um pedido pode ter até 20.000 caracteres.

- Os pedidos rodam **um de cada vez**, em ordem. Enquanto um roda, os novos esperam; o chat mostra **Pedidos na fila: N**.
- Cada membro pode ter até **5 pedidos esperando**.
- **Cancelar o pedido** interrompe o que está rodando (ou o tira da fila). Os membros cancelam os próprios pedidos; o dono pode cancelar os de qualquer um.

## Enquanto o agente trabalha

**O agente está trabalhando** mostra uma linha curta de status que muda conforme ele avança: *Editando src/App.vue*, *Executando: npm run build*, *Buscando…*. O agente também pode escrever mensagens para você durante a execução.

Um pedido pode rodar por no máximo 2 horas, dentro do [orçamento](/pt-br/agent/costs-and-limits/) dele.

## Quando termina

| Resultado | O que você vê |
| --- | --- |
| Mudanças feitas | Um resumo para quem não é técnico (um título e alguns tópicos) e o cartão **Homologação pronta · versão N** com **Ver a homologação**, **Ver as mudanças no GitHub**, **Aprovar e publicar** e **Descartar**. |
| Nada a mudar | O resumo e *Nada mudou na homologação.* |
| Uma pergunta | O agente precisa de uma decisão que só você pode tomar. Ele mostra a pergunta com opções em botões; toque em uma ou escreva a sua resposta. A resposta continua o mesmo trabalho. |
| Falhou ou foi cancelado | Por que parou. A homologação não foi alterada. |

Os pedidos seguintes na mesma homologação continuam a mesma conversa, então *"deixe maior"* tem contexto. Depois que você aprova ou descarta, o próximo pedido começa do zero.

## Quando o agente está desligado

*"O agente está desligado porque ainda não tem um provedor."* O dono do projeto (ou um admin da organização) precisa escolher um [provedor de modelo](/pt-br/agent/providers/). Até lá, o projeto continua publicando o que chega ao GitHub.

## Idioma

O agente escreve para você no **Idioma do agente** do projeto (português do Brasil, inglês ou espanhol), definido em **Configurações › Agente**. No Telegram, o bot segue o idioma do Telegram de cada pessoa.
