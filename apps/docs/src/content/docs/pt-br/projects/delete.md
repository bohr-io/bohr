---
title: Excluir um projeto
description: Remova um projeto e tudo o que a bohr criou para ele, mantendo ou apagando o site publicado.
sidebar:
  order: 8
---

A **Zona de perigo**, no fim de **Configurações › Geral**, exclui o projeto. Só o dono pode fazer isso, e não dá para desfazer.

1. Clique em **Excluir projeto**.
2. Leia o que sai e o que fica.
3. Opcional: marque **Também apagar o site publicado na minha conta Cloudflare**.
4. Digite o nome do projeto para confirmar e excluir.

## O que sai

- O agente do projeto: os Workers dele (o Worker do projeto e o Worker da homologação) e o container.
- A homologação, a hospedagem da bohr e as rotas da bohr, nos projetos hospedados pela bohr.
- O projeto na bohr: os membros, o chat, as configurações e as variáveis.

## O que fica

- **O repositório no GitHub não é alterado.**
- **O site publicado na sua conta da Cloudflare continua no ar**, a menos que você tenha marcado a opção acima. Essa opção remove o Worker de produção do site e os secrets de Actions `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` que versões antigas da bohr podem ter deixado no repositório, para que ele não seja publicado de novo.
- **O bot do projeto no Telegram continua existindo.** Apague-o no @BotFather se quiser.

O `.github/workflows/bohr-deploy.yml` do repositório também fica. Depois que o projeto é excluído, a bohr não entrega mais credenciais de deploy a ele, então as execuções falham; apague o arquivo se não precisar dele.

Se algo não pôde ser removido, o painel avisa *"O projeto foi excluído, mas algo ficou para trás"* com a lista, para você limpar à mão.
