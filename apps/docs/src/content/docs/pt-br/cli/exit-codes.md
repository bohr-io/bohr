---
title: Códigos de saída e erros
description: O que significa cada código de saída e código de erro da CLI do bohr, e o que fazer.
sidebar:
  order: 6
---

| Código | Significado | O que fazer |
| --- | --- | --- |
| **0** | Pronto | — |
| **1** | Falhou: o build, um upload, o wrangler, uma migration do D1, a instância, a rede, ou deploys demais em poucos minutos | Leia a mensagem. Corrija o build, ou tente de novo mais tarde em erros de rede e limites de taxa. |
| **2** | Uso errado: uma opção desconhecida, opções que não combinam, nenhum branch num HEAD destacado, um `.bohr/deploy.json` ou `.bohr/project.json` inválido | Corrija o comando ou o arquivo. |
| **3** | Não entrou, ou o token foi rejeitado (expirado, revogado, malformado) | Rode `bohr login`, ou defina `BOHR_TOKEN` com um token válido de **Conta › Tokens**. |
| **4** | Projeto não encontrado para este token, nenhum endereço para aquele branch, ou a pasta não é um projeto da bohr v2 | Confira `bohr projects`, os projetos do token, ou rode na pasta certa. |
| **5** | Não permitido: produção sem o papel de dono, um projeto na conta Cloudflare do dono sem o papel de dono, um projeto suspenso, uma pasta cuja configuração do wrangler dá outro nome de Worker | Faça deploy de uma homologação, faça push num branch para o workflow do projeto, ou faça deploy de produção pelo painel. |

## Códigos de erro

Com `--json`, `error.code` diz exatamente o que aconteceu:

| `error.code` | Saída | Significado |
| --- | --- | --- |
| `usage` | 2 | Comando ou opção desconhecida, ou opções que não combinam |
| `no_project` | 2 | Sem `--project`, sem vínculo e sem remote do GitHub: *"Which project? … Pass --project &lt;id&gt; (see "bohr projects"), or run "bohr link"."* |
| `no_branch` | 2 | HEAD destacado: passe `--branch` |
| `invalid_deploy_config` | 2 | `.bohr/deploy.json` não é um JSON válido ou quebra [as regras dele](/pt-br/deploys/deploy-json/) |
| `invalid_link` | 2 | `.bohr/project.json` é inválido: rode `bohr link` de novo |
| `not_signed_in` | 3 | Sem token: rode `bohr login` ou defina `BOHR_TOKEN` |
| `invalid_token` | 3 | `BOHR_TOKEN` não começa com `bohr_` |
| `login_denied`, `login_expired` | 3 | O `bohr login` foi recusado, ou o código dele expirou |
| `http_401` | 3 | A instância rejeitou o token (expirado ou revogado) |
| `project_not_found`, `http_404` | 4 | Nenhum projeto para este repositório ou id que este token alcance |
| `not_a_v2_project` | 4 | A pasta não é um projeto da bohr v2 (inclusive repositórios da bohr v1). Nada foi alterado. |
| `no_address` | 4 | `bohr open`: o branch nunca teve deploy |
| `own_account_not_allowed` | 5 | O projeto roda na conta Cloudflare do dono, e só os donos (admins da organização dele) podem fazer deploy dele pela CLI, homologações incluídas. Faça push num branch: o workflow dele faz o deploy do branch de produção |
| `worker_mismatch` | 5 | `--prod`: a configuração do wrangler da pasta dá outro nome de Worker que não o do site do projeto. Nada recebeu deploy |
| `own_account` | 5 | Só na CLI 4.0.0 e anteriores, que não faziam deploy de projetos na conta Cloudflare do dono: atualize com `npx bohr@latest` |
| `production_not_allowed` | 5 | Produção exige o papel de dono |
| `production_branch` | 5 | O branch de produção exige `--prod` |
| `production_on_v1` | 5 | A bohr v1 ainda serve o endereço de produção: faça deploy de homologações até o workflow do repositório movê-lo |
| `suspended`, `http_403` | 5 | O projeto está suspenso, ou a instância recusou a ação |
| `cancelled` | 1 | Você respondeu não à pergunta de produção |
| `network_error` | 1 | Não foi possível falar com a instância |
| `rate_limited` | 1 | Deploys demais de um projeto na sua própria conta da Cloudflare nos últimos minutos (HTTP 429): espere alguns minutos |
| `error`, `http_<status>` | 1 | Todo o resto: o build falhou, um upload falhou, o wrangler ou uma migration do D1 falhou, a Cloudflare recusou o deploy… |

As mensagens são feitas para pessoas e podem mudar; os códigos são estáveis.
