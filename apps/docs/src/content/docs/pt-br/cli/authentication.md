---
title: Autenticação
description: Entre na CLI com bohr login, use um token do painel com BOHR_TOKEN, ou o OIDC do GitHub no Actions.
sidebar:
  order: 2
---

A CLI se autentica de uma de três formas, nesta ordem:

1. **`BOHR_TOKEN`**, quando definida: um token do painel. Para scripts, CI e agentes de IA.
2. **O login guardado pelo `bohr login`**, para aquela instância. Para pessoas no próprio computador.
3. **OIDC do GitHub**, no GitHub Actions sem `BOHR_TOKEN` (precisa de `permissions: id-token: write`).

## bohr login

```sh
bohr login
```

A CLI mostra um link e um código, e abre o navegador:

```
To sign in, open https://app.bohr.io/cli?code=BCDF-GHJK
and approve "CLI on my-laptop" with the code BCDF-GHJK.
```

No painel (**Entrar na CLI do bohr**), confira se o código é o mesmo do seu terminal e clique em **Aprovar**. Aprove só uma entrada que você mesmo começou: senão, quem mandou um link desses poderia fazer deploy como você. O código vale por 10 minutos.

Depois disso a CLI guarda um token próprio, chamado **"CLI on &lt;seu computador&gt;"**, com acesso a todos os seus projetos e sem expiração. Ele fica em `credentials.json` na sua pasta de configuração, que só você consegue ler:

| Sistema | Pasta |
| --- | --- |
| Linux | `$XDG_CONFIG_HOME/bohr` ou `~/.config/bohr` |
| macOS | `~/Library/Application Support/bohr` |
| Windows | `%APPDATA%\bohr` |

`BOHR_CONFIG_DIR` substitui a pasta. Fica guardado um login por instância.

```sh
bohr whoami     # em nome de quem a CLI age, e com qual token
bohr logout     # revoga o token deste computador e o esquece
```

## Tokens para scripts e agentes

Crie um token no painel, em **Conta › Tokens** ([detalhes](/pt-br/account/tokens/)): um nome, os projetos que ele pode usar e uma expiração. O painel mostra o token uma única vez. Depois:

```sh
export BOHR_TOKEN=bohr_…
bohr deploy --json
```

- Tokens começam com `bohr_`. Qualquer outra coisa em `BOHR_TOKEN` é recusada (código de saída 3).
- Um token age como você, nos projetos dos quais você é membro, limitado aos que ele lista. Ele nunca carrega o papel de administrador da instância.
- `BOHR_TOKEN` tem prioridade sobre o login guardado. O `bohr login` avisa quando ela está definida.
- Revogue o token no painel quando quiser; os scripts que o usam param na hora (código de saída 3).

## GitHub Actions com OIDC

Num workflow com `permissions: id-token: write` e sem `BOHR_TOKEN`, o `bohr deploy` entra com o token OIDC do GitHub da execução e faz deploy **do repositório da execução e do branch que recebeu o push**, como a deploy action. `--prod`, `--branch` e `--project` precisam de `BOHR_TOKEN`. Veja [Uso em CI](/pt-br/cli/ci/).

## Instâncias auto-hospedadas

Todo comando aceita `--instance <url>`, ou a variável `BOHR_INSTANCE_URL`. O padrão é `https://app.bohr.io`. O endereço precisa usar `https` (exceto `localhost`).

```sh
bohr login --instance https://bohr.example.com
```
