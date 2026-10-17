---
title: Comandos
description: Todos os comandos da CLI do bohr, com opções e exemplos.
sidebar:
  order: 4
---

```
bohr <command> [options]
```

| Comando | O que faz |
| --- | --- |
| [`deploy`](/pt-br/cli/deploy/) | Faz o build e o deploy desta pasta (uma homologação, ou produção com `--prod`) |
| [`login`](#bohr-login) | Entra a partir deste computador (aprove no navegador) |
| [`logout`](#bohr-logout) | Sai: revoga o token deste computador e o esquece |
| [`whoami`](#bohr-whoami) | Mostra em nome de quem a CLI age, e com qual token |
| [`projects`](#bohr-projects) | Lista os projetos que o token alcança |
| [`link`](#bohr-link) | Vincula esta pasta a um projeto (`.bohr/project.json`) |
| [`open`](#bohr-open) | Imprime a URL do projeto e a abre no navegador |

## Opções de todos os comandos

| Opção | Descrição |
| --- | --- |
| `--instance <url>` | A instância da bohr (padrão: `$BOHR_INSTANCE_URL`, o vínculo da pasta, ou `https://app.bohr.io`) |
| `--json` | Imprime um objeto JSON com o resultado, para scripts e agentes de IA ([schemas](/pt-br/cli/json-output/)) |
| `-h`, `--help` | Mostra a ajuda |
| `-v`, `--version` | Imprime a versão (`bohr --version`) |

Opções desconhecidas e argumentos a mais são erros de uso (código de saída 2).

## bohr login

```sh
bohr login [--instance <url>]
```

Inicia uma entrada, mostra o link e o código, abre o navegador (num terminal) e espera até você aprovar no painel. Guarda um token chamado "CLI on &lt;computador&gt;". Veja [Autenticação](/pt-br/cli/authentication/#bohr-login).

Falha com o código de saída 3 quando a entrada é recusada (`login_denied`) ou quando o código expira depois de 10 minutos (`login_expired`).

## bohr logout

```sh
bohr logout [--instance <url>]
```

Revoga o token guardado na instância e o apaga do `credentials.json`. Se não conseguir falar com a instância, ainda assim esquece o token e pede para você revogá-lo no painel. Avisa quando `BOHR_TOKEN` ainda está definida.

## bohr whoami

```sh
bohr whoami [--instance <url>] [--json]
```

```console
$ bohr whoami
Ada Lovelace <ada@example.com> on https://app.bohr.io
Token "deploy agent" (BOHR_TOKEN): 2 selected projects, expires 2027-01-10T12:00:00.000Z
```

## bohr projects

```sh
bohr projects [--instance <url>] [--json]
```

Lista os projetos que o token alcança:

```console
$ bohr projects
ID            NAME     REPOSITORY      HOSTED       ROLE    URL
p3k9x0a7qd2m  my-site  acme/my-site    bohr         owner   https://my-site-acme.bohr.io
p8b2m4c6d1ef  shop     acme/shop       own account  member  -
```

**HOSTED** é `bohr` para projetos que a bohr hospeda e `own account` para projetos na conta Cloudflare do dono. O `bohr deploy` publica os dois; os projetos na conta do dono, só para os donos ([detalhes](/pt-br/cli/deploy/#projetos-na-sua-própria-conta-da-cloudflare)).

## bohr link

```sh
bohr link [--project <id>] [--instance <url>] [--json]
```

Escreve `.bohr/project.json` na raiz do repositório, para que `bohr deploy` e `bohr open` saibam o projeto sem um remote do GitHub. Sem `--project`, usa o projeto do remote `origin`. O arquivo também registra a instância, quando ela não é a padrão.

```json
{
  "projectId": "p3k9x0a7qd2m"
}
```

Faça commit dele se todo mundo que trabalha na pasta deve fazer deploy no mesmo projeto.

## bohr open

```sh
bohr open [--branch <name>] [--print] [--project <id>] [--instance <url>] [--json]
```

Imprime a URL de produção (ou a homologação do `--branch`) e a abre no navegador. `--print` só imprime. Falha com o código de saída 4 (`no_address`) quando aquele branch nunca teve deploy.

```sh
bohr open --branch feature/new-menu --print
```

## Depuração

Defina `BOHR_DEBUG=1` para imprimir o stack trace de um erro no stderr.
