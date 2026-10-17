---
title: Variáveis de ambiente
description: As variáveis de ambiente que a CLI do bohr lê.
sidebar:
  order: 8
---

| Variável | Descrição |
| --- | --- |
| `BOHR_TOKEN` | Um token de **Conta › Tokens** (`bohr_…`). Tem prioridade sobre o login guardado pelo `bohr login`. |
| `BOHR_INSTANCE_URL` | A instância da bohr, para instâncias auto-hospedadas. Padrão `https://app.bohr.io`. `--instance` tem prioridade sobre ela. |
| `BOHR_CONFIG_DIR` | Onde fica o `credentials.json`. Padrão: `$XDG_CONFIG_HOME/bohr`, `~/.config/bohr` (Linux), `~/Library/Application Support/bohr` (macOS), `%APPDATA%\bohr` (Windows). |
| `XDG_CONFIG_HOME` | Usada para a pasta de configuração quando `BOHR_CONFIG_DIR` não está definida. |
| `BOHR_DEBUG` | Qualquer valor imprime os stack traces dos erros no stderr. |
| `CI` | Quando definida, a CLI nunca pergunta e nunca abre o navegador. |

Variáveis que a CLI lê no GitHub Actions:

| Variável | Uso |
| --- | --- |
| `GITHUB_ACTIONS` | Liga o formato de log do Actions, os outputs e as máscaras |
| `ACTIONS_ID_TOKEN_REQUEST_URL`, `ACTIONS_ID_TOKEN_REQUEST_TOKEN` | Presentes com `id-token: write`: a CLI consegue entrar com OIDC |
| `GITHUB_SHA` | O commit registrado com o deployment |
| `GITHUB_HEAD_REF`, `GITHUB_REF` | O branch, num HEAD destacado |
| `GITHUB_OUTPUT` | Para onde vão os step outputs `url` e `deployment-id` |

## Precedência da instância

1. `--instance <url>`
2. `BOHR_INSTANCE_URL`
3. `instanceUrl` no `.bohr/project.json` da pasta (`bohr deploy` e `bohr open`)
4. `https://app.bohr.io`
