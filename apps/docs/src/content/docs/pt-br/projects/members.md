---
title: Membros e papéis
description: Convide pessoas para um projeto com códigos de uso único e gerencie quem tem acesso.
sidebar:
  order: 3
---

Todos num projeto podem pedir mudanças e aprovar publicações. Só o **dono** gerencia chaves, configurações e acessos.

| Papel | Pode |
| --- | --- |
| **Dono** | Tudo: configurações, variáveis, domínios, autenticação, convites, remover membros, excluir o projeto |
| **Membro** | Pedir mudanças, aprovar, descartar e reverter, cancelar os próprios pedidos, ver as configurações |

O dono do projeto é quem o criou. Numa [organização](/pt-br/organizations/members/), os admins da organização são os donos de todos os projetos dela, e os membros dela são membros: eles não precisam de convite.

## Convidar alguém

1. Abra **Membros** e, em **Convidar alguém**, clique em **Gerar código de convite**.
2. Compartilhe o código (**Copiar o código**) ou o link (**Copiar o link**). O código é de uso único e vale por **24 horas**.
3. A pessoa:
   - abre o link, entra com a própria conta e encontra o código já preenchido (**Entrar no projeto**); ou
   - manda `/entrar <código>` para o bot do projeto no Telegram.

Os códigos têm o formato `K7P2-9QXM` e são tolerantes quando digitados à mão: maiúsculas e minúsculas, espaços e as letras `I`, `L` e `O` não atrapalham. No Telegram, o dono também pode mandar `/convidar`.

## Remover alguém

Clique em **Remover** ao lado da pessoa e confirme. Ela perde o acesso ao projeto na web e no Telegram na hora, e os pedidos dela que estavam esperando são cancelados. O dono não pode ser removido.

No Telegram: `/membros` lista as pessoas com números, e `/revogar <número>` remove uma delas.
