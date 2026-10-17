---
title: O que o agente pode e não pode fazer
description: As ferramentas do agente, o sandbox dele e os limites que a bohr coloca em volta dele.
sidebar:
  order: 6
---

O agente é construído com o Claude Agent SDK e roda em um **sandbox** isolado (um Cloudflare Container na conta do dono do projeto) com uma cópia nova do seu repositório.

## O que ele pode fazer

- **Ler e mudar qualquer arquivo** do repositório, e criar novos.
- **Rodar comandos**: instalar dependências, fazer o build, rodar testes, checagem de tipos e linters. Ele é instruído a rodar as checagens do projeto antes de terminar e a corrigir o que a mudança dele quebrou.
- **Buscar** no código, e pesquisar na web quando o modelo suporta.
- **Rodar a homologação**: manter o `.bohr/preview.json` funcionando para você ver a mudança.
- **Configurar a produção**: manter o `.bohr/deploy.json` e a configuração do wrangler funcionando quando uma mudança afeta o build.
- **Perguntar a você** quando uma decisão é sua (uma escolha entre alternativas que ele não consegue deduzir), com opções em botões.
- **Seguir as instruções do seu repositório**: ele lê o `CLAUDE.md` e o `.claude/settings.json` do repositório.
- **Manter o contexto** entre os pedidos seguintes na mesma homologação.

No fim de cada pedido, ele escreve um resumo para quem não é técnico: um título (que vira a mensagem do commit) e alguns tópicos sobre o que mudou e o que conferir.

## O que ele não pode fazer

| Ele não pode | Porque |
| --- | --- |
| Publicar na produção | Ele só consegue fazer push para `homolog`. A produção só muda quando alguém aprova. |
| Fazer push, pull, merge, rebase ou trocar de branch | A bohr faz commit de tudo o que ficou na working tree e faz push para `homolog` quando o agente termina. |
| Mudar workflows do GitHub Actions | O GitHub recusa mudanças em `.github/workflows` vindas do token do sandbox, e a bohr restaura esses arquivos antes do commit. Se um workflow precisar de mudança, o agente avisa no resumo. |
| Mudar remotes do git, credenciais ou o `.git` | Recusado pelas proteções da bohr. |
| Escrever fora do repositório e do `/tmp` | Recusado pelas proteções da bohr. |
| Ver as suas chaves | O sandbox só guarda marcadores; a bohr acrescenta a chave real do modelo e um token do GitHub de curta duração na saída, só enquanto um pedido roda. |
| Guardar arquivos entre sessões | O disco do sandbox é apagado quando ele dorme; só fica o que foi enviado ao GitHub. |
| Rodar git hooks | Os commits e pushes pulam os hooks; em vez disso, o próprio agente roda as checagens. |

Arquivos que nunca entram no commit, mesmo quando o `.gitignore` não os cobre: `node_modules/`, `.venv/`, `__pycache__/` e `.wrangler/`.

## Quando um pedido falha

Um pedido para quando atinge o **orçamento** ou o **máximo de turnos**, por um erro, ou quando alguém o cancela. Aí `homolog` volta para onde estava antes do pedido: nada feito pela metade é enviado. O chat explica o motivo, no seu idioma. Veja [Custos e limites](/pt-br/agent/costs-and-limits/).

## Serviços com estado e bancos de dados

Na primeira execução, o agente mapeia o projeto para a Cloudflare (veja [O que você precisa](/pt-br/introduction/requirements/#projetos-suportados)). Quando um projeto precisa de um banco de dados ou de Redis e não há dados de conexão configurados, o agente explica o que você precisa fornecer. Mudanças que movem filas para o Cloudflare Queues ou gravações em disco para o R2 mudam o seu código, então o agente pergunta antes de fazê-las.
