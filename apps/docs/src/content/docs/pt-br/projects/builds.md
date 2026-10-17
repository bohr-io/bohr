---
title: Builds
description: As execuções do GitHub Actions no repositório do projeto, com os jobs e os logs.
sidebar:
  order: 2
---

**Builds** lista as execuções do GitHub Actions no repositório: cada deploy, com os passos e os logs, sem sair da bohr.

- Cada execução mostra o título, o número, o branch, a situação e quando rodou. **Ver no GitHub** abre a execução lá.
- Abra uma execução para ver os jobs e o **Log** de cada job. Enquanto uma execução está em andamento, *esta página se atualiza sozinha*.
- **Atualizar** recarrega a lista.

| Situação | Significado |
| --- | --- |
| **Na fila** | Esperando um runner |
| **Rodando** | Em andamento |
| **Sucesso** | Terminou; num deploy, a produção já serve essa versão |
| **Falhou** | Um passo falhou; abra o log dele |
| **Cancelado** | Cancelado no GitHub |
| **Ignorado** | O GitHub pulou a execução |
| **Precisa de ação** | O GitHub precisa que alguém aja (por exemplo, aprovar uma execução) |

*Nenhum build ainda* quer dizer que o GitHub Actions ainda não rodou no repositório. Num projeto novo, o primeiro deploy roda depois que você aprova a [preparação do repositório](/pt-br/getting-started/first-deploy/) feita pelo agente.

Quando um deploy falha, o chat avisa *"O deploy de produção falhou"* com um link para a execução, e a produção continua servindo a versão anterior. Peça ao agente para corrigir, colando a linha do erro se quiser: *"O deploy falhou com: …. Corrija."* Veja também [Solução de problemas](/pt-br/reference/troubleshooting/#deploys).
