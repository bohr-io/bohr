---
title: Excluir sua conta
description: Remova a sua conta da bohr e tudo o que a bohr criou para ela.
sidebar:
  order: 3
---

A **Zona de perigo**, no fim de **Conta**, exclui a sua conta. Não dá para desfazer.

1. Clique em **Excluir conta**.
2. Leia o que sai e o que fica.
3. Opcional: marque **Também apagar os sites publicados na minha conta Cloudflare**.
4. Digite `EXCLUIR` para confirmar (`DELETE` em inglês).

## O que sai

- Todos os seus projetos: os Workers dos agentes e a hospedagem da bohr.
- O app do GitHub é desinstalado das suas contas.
- As conexões com a Cloudflare são removidas.
- O vínculo com o Telegram é desfeito.
- As configurações do agente são apagadas.
- A assinatura do bohr.io Cloud é cancelada.

## O que fica

- **Os repositórios no GitHub nunca são alterados.**
- **Os bots dos projetos continuam no Telegram.** Apague-os no BotFather se quiser.
- **Os sites publicados na sua conta da Cloudflare continuam no ar**, a menos que você tenha marcado a opção, que remove os Workers de produção dos sites nas contas da Cloudflare conectadas.

## Suas organizações

- Uma organização em que você é o **único membro ativo** é excluída junto com a sua conta.
- Numa organização com outros membros, os projetos que você criou, as conexões com a Cloudflare que você fez e a assinatura que você paga passam para outro membro ativo (um admin, quando houver).
- Se você for o **último admin** de uma organização com outros membros, a bohr recusa: *"You are the last admin of … Make another member an admin first, or delete the organization."*

Numa instância self-hosted, o único administrador não pode excluir a própria conta enquanto existirem outros usuários (*"You are the only admin. Make someone else an admin first."*).

Quando algo não pôde ser removido, a página de entrada mostra *"Algumas coisas ficaram para trás e precisam ser removidas à mão"* com a lista.
