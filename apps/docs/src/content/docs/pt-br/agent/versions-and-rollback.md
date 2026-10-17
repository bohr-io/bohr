---
title: Versões e reversão
description: Todas as publicações que a bohr fez, e como voltar a produção para a versão anterior.
sidebar:
  order: 4
---

Cada aprovação vira um pull request mesclado no branch de produção, e o GitHub Actions o publica. **Versões** (menu do projeto) lista essas publicações, das mais novas para as mais antigas.

## A lista

Cada publicação mostra quando foi **Publicada**, o pull request **via** o qual veio (**PR #N**, ou um **commit direto**), links para **Ver PR** e **Ver commit**, e o status:

| Status | Significado |
| --- | --- |
| **Publicando** | A execução do GitHub Actions está fazendo o deploy |
| **No ar** | A execução terminou; a produção a serve |
| **Falhou** | A execução falhou; a produção manteve a versão anterior |
| **Revertida** | Uma reversão a desfez |

## Reverter

Clique em **Reverter a última publicação** e confirme. A bohr abre e faz o merge de um pull request que **desfaz** o pull request da última publicação, usando o revert do GitHub. Em seguida, o GitHub Actions publica a versão anterior.

No Telegram, mande `/rollback` (ou `/reverter`).

- Reverter também é uma publicação: aparece na lista e também pode ser revertida.
- A reversão desfaz o código. Os dados que o seu site gravou (por exemplo, linhas em um banco de dados D1) e as migrações de schema que já rodaram não são desfeitos.
- Se o GitHub não consegue reverter de forma limpa (uma mudança posterior mexeu nas mesmas linhas), a bohr diz *"Não consegui reverter"* com o motivo. Nesse caso, peça ao agente para desfazer a mudança.

## Mudanças feitas fora da bohr

Os pushes para o branch de produção que não vieram de uma aprovação (seus, da sua equipe ou de outra ferramenta) também fazem deploy, pelo mesmo workflow. Eles aparecem em [Builds](/pt-br/projects/builds/).
