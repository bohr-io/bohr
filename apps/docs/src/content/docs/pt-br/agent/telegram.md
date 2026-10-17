---
title: Telegram
description: Converse com o agente e aprove publicações pelo bot do Telegram do projeto, e os comandos que ele entende.
sidebar:
  order: 2
---

Cada projeto pode ter o próprio **bot do Telegram**. É a mesma conversa do chat web: você pede mudanças, abre a homologação e aprova ou descarta com botões.

## Conectar um bot

1. No Telegram, abra o **@BotFather** e mande `/newbot`.
2. Escolha um nome e um nome de usuário que termine em `bot`.
3. Copie o token que o BotFather manda (ele se parece com `123456789:AA…`).
4. No projeto, abra **Configurações › Agente**, cole o token em **Telegram** e clique em **Conectar o bot**. (O fluxo de novo projeto oferece o mesmo passo.)

Só o dono do projeto conecta o bot. Para deixar de usá-lo, apague o bot com o BotFather; a bohr não apaga bots de projeto.

## Vincular a sua conta do Telegram

O bot reconhece as pessoas pela conta delas na bohr. Em **Conta**, clique em **Vincular o Telegram**, depois em **Abrir no Telegram** e toque em **Iniciar**. O link vale por alguns minutos. (Isso exige o bot da plataforma da instância, que o bohr.io Cloud tem; em uma instância auto-hospedada, o administrador o configura.)

Quem ainda não é membro recebe: *"Você ainda não tem acesso ao projeto … Peça um convite ao dono e mande /entrar &lt;código&gt;."*

## Conversando com o bot

- **Em uma conversa privada**, toda mensagem é um pedido.
- **Em um grupo**, o bot responde às mensagens que o mencionam (`@seu_bot`), às respostas às mensagens dele e aos comandos.

Enquanto o agente trabalha, o bot mantém uma mensagem de status atualizada. Quando termina, ele manda o resumo e os botões **Aprovar e publicar**, **Descartar**, **🔎 Ver a homologação** e **Ver as mudanças no GitHub**, presos àquela versão da homologação: um botão apertado em uma versão antiga responde *"A homologação mudou desde esta mensagem."*

## Comandos

Cada comando também tem um nome em inglês e em espanhol.

| Comando | Também | O que faz |
| --- | --- | --- |
| `/status` | `/estado` | O pedido em andamento, a fila e a homologação |
| `/aprovar`, `/descartar` | `/approve`, `/aprobar`, `/discard` | Mostra as mudanças da homologação atual com os botões para decidir |
| `/cancelar` | `/cancel` | Cancela o seu pedido em andamento ou na fila |
| `/rollback` | `/reverter`, `/revertir` | Volta a produção para a versão anterior |
| `/convidar` | `/invite`, `/invitar` | Cria um código de convite (dono) |
| `/entrar <código>` | `/join`, `/unirse` | Entra no projeto com um código de convite |
| `/membros` | `/members`, `/miembros` | Lista os membros com números |
| `/revogar <número>` | `/revoke`, `/revocar` | Remove um membro (dono) |
| `/modelo <nome>` | `/model` | Define o modelo do projeto (dono) |
| `/orcamento <dólares>` | `/budget`, `/presupuesto` | Define o orçamento por pedido, de 0,10 a 1000 (dono) |
| `/ajuda` | `/help`, `/ayuda` | Lista os comandos |

Os comandos `/aprovar` e `/descartar` digitados nunca agem sozinhos: eles mostram os botões da versão que você está vendo, para que você sempre decida sobre o que revisou.

## O bot da plataforma

As instâncias com um bot da plataforma (como a do bohr.io Cloud) também deixam você fazer a configuração inicial pelo Telegram: `/novo` cria um projeto, `/status` lista os seus projetos e `/tentar` refaz o último passo que falhou. As configurações do agente continuam sendo escolhidas no painel web.
