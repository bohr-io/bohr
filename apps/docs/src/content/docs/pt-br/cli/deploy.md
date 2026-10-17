---
title: bohr deploy
description: Faça o build e o deploy de uma pasta como homologação de um branch, ou como produção com --prod.
sidebar:
  order: 3
---

```sh
bohr deploy [--prod] [--branch <name>] [--project <id>] [--dir <path>] [--no-build] [--yes] [--json] [--instance <url>]
```

Faz o build do projeto e o publica. **Homologações por padrão**; produção só com `--prod`.

## Opções

| Opção | Descrição |
| --- | --- |
| `--prod` | Faz deploy de produção (só donos do projeto). |
| `--branch <name>` | O branch da homologação. Padrão: o branch em checkout. |
| `--project <id>` | O id do projeto (veja `bohr projects`). Padrão: o vínculo da pasta, ou o remote do GitHub. |
| `--dir <path>` | Pasta com a configuração do wrangler. Padrão: `directory` do `.bohr/deploy.json`, ou a pasta atual. |
| `--no-build` | Faz deploy do que já foi construído: pula o install e o build do `.bohr/deploy.json`. |
| `-y`, `--yes` | Não pergunta antes de fazer deploy de produção. |
| `--json` | Imprime um objeto JSON com o resultado ([schema](/pt-br/cli/json-output/#bohr-deploy)). |
| `--instance <url>` | A instância da bohr. Padrão: `BOHR_INSTANCE_URL`, o vínculo da pasta, ou `https://app.bohr.io`. |
| `-h`, `--help` | Mostra a ajuda do comando. |

## O que ele faz

1. **Qual projeto**: `--project <id>`, senão o vínculo da pasta (`.bohr/project.json`, escrito pelo [`bohr link`](/pt-br/cli/commands/#bohr-link)), senão o projeto do remote do GitHub do repositório (`origin`).
2. **Qual branch**: `--branch`, senão o branch em checkout. No **branch de produção** sem `--prod`, ele publica uma homologação em `<branch de produção>-preview` e avisa.
3. **Build**: roda `install` e `build` do [`.bohr/deploy.json`](/pt-br/deploys/deploy-json/) na pasta dele, a não ser com `--no-build`. O seu ambiente é o do build: as variáveis de build guardadas na bohr não são baixadas. Ele avisa quando a versão major do seu Node.js é diferente de `node`, ou quando um nome em `secrets` não está definido.
4. **Bundle**: o Worker é empacotado com `wrangler deploy --dry-run` (não precisa de credenciais da Cloudflare). Adicione `wrangler` às suas `devDependencies` para fixar a versão.
5. **Upload**: os arquivos estáticos recebem hash como o wrangler faz; só arquivos novos ou alterados são enviados.
6. **Publicação**: a URL é impressa no stdout. O progresso vai para o stderr.

Os passos 3 a 6 são os de um projeto que **a bohr hospeda**. Um projeto na conta Cloudflare do dono faz o build com as variáveis do build dele e o deploy com o wrangler: veja [Projetos na sua própria conta da Cloudflare](#projetos-na-sua-própria-conta-da-cloudflare).

```console
$ bohr deploy
Deploying a preview of feature/new-menu of my-site (p3k9x0a7qd2m) on https://app.bohr.io.
…
42 files (1.3 MiB), 3 uploaded; 1 Worker module.
https://feature-new-menu-my-site-acme.bohr.io
```

## Produção

```sh
bohr deploy --prod
```

- Só os **donos** do projeto (admins da organização dele) podem fazer deploy de produção. Os outros recebem o código de saída 5 (`production_not_allowed`).
- Num terminal, a CLI pergunta `Deploy this folder to production (…)? [y/N]` (`… in the owner's Cloudflare account? [y/N]` para um projeto na conta do dono). `--yes` pula a pergunta; sem terminal, ou com `--json`, ela nunca pergunta: o próprio `--prod` é a confirmação.
- `--prod` com um `--branch` diferente do branch de produção é um erro de uso.
- Um projeto cujo endereço de produção a bohr v1 ainda serve fica a cargo do workflow do repositório, cujo primeiro deploy de produção move o endereço (`production_on_v1`, código de saída 5). Até lá, faça deploy de homologações.

## Nada sai do ar

O que é servido só muda depois que todos os arquivos foram enviados e a Cloudflare aceitou a nova versão. Qualquer falha antes disso deixa a versão anterior no ar. O passo final nunca é repetido, então um deploy não tem como publicar duas vezes. Para projetos na sua própria conta da Cloudflare, veja [abaixo](#nunca-tira-um-site-do-ar).

## O que nunca é publicado

Arquivos ou pastas `.git` e `.env` (`.env`, `.env.production`…), em qualquer profundidade, não importa o que diga o `.assetsignore`. Cada `.env` ignorado é informado com um aviso.

## Quais projetos

O `bohr deploy` publica os dois tipos de projeto da bohr v2:

- **Projetos que a bohr hospeda** (migrados da bohr v1) sobem pelo caminho de upload da bohr, como descrito acima.
- **Projetos na conta Cloudflare do dono** recebem o deploy do wrangler nessa conta, [como descrito abaixo](#projetos-na-sua-própria-conta-da-cloudflare). Só os donos podem fazer deploy deles pela CLI.

A CLI 4.0.0 e anteriores recusavam o segundo tipo com o código de saída 5 (`own_account`). Se você vir esse código, atualize a CLI: `npx bohr@latest`.

Uma pasta que não é um projeto da bohr v2 (sem configuração do wrangler, sem `.bohr/project.json`, sem `.bohr/deploy.json`) para com *"This repository is not a bohr v2 project"* (código de saída 4); repositórios que ainda estão na bohr v1 são reconhecidos, e o comando vai sem mudanças para a CLI da bohr v1.

## Projetos na sua própria conta da Cloudflare

Um projeto na conta Cloudflare do dono (`own account` no [`bohr projects`](/pt-br/cli/commands/#bohr-projects), `mode: "byo"` no JSON dele) recebe o deploy do wrangler, nessa conta, de um jeito parecido com o do [workflow de deploy](/pt-br/deploys/deploy-workflow/) dele. Isso exige a CLI 4.1.0 ou mais nova, o Node.js 20 ou mais novo e o `npx`.

### Quem pode fazer deploy

Só os **donos** do projeto (num projeto de organização: os admins da organização) podem fazer deploy dele pela CLI, **homologações incluídas**: o wrangler faz o deploy com o token da API da Cloudflare que o dono conectou à bohr. Os membros recebem o código de saída 5 (`own_account_not_allowed`); eles fazem push num branch, e o workflow do projeto faz o deploy do branch de produção. O token (`BOHR_TOKEN` ou `bohr login`) também precisa alcançar o projeto: um token limitado a alguns projetos precisa listá-lo.

### O que roda

1. **Credenciais**: a CLI pede à instância o token da API da Cloudflare e o id da conta do dono, só para este deploy.
2. **Build**: a não ser com `--no-build`, os comandos `install` e `build` do [`.bohr/deploy.json`](/pt-br/deploys/deploy-json/) rodam com as [variáveis do build](/pt-br/projects/variables/#variáveis-do-build) guardadas na bohr no ambiente (para o branch do deploy: os valores do projeto todo, sobrescritos pelos do branch). O build nunca recebe o token da Cloudflare nem o `BOHR_TOKEN`.
3. **Proteção**: quando o `.bohr/deploy.json` usa o comando `deploy` padrão, o portão de proteção da bohr envolve o site como no workflow de deploy, então a [proteção por senha](/pt-br/projects/password-protection/) também cobre as homologações.
4. **wrangler**: o wrangler do próprio projeto quando ele tem um instalado, senão `npx wrangler@4.149.0`. Homologações precisam do wrangler 4.21.0 ou mais novo (que trouxe os aliases de preview): com um wrangler mais antigo no projeto, as homologações rodam o 4.149.0.

### Homologações

```sh
bohr deploy
```

envia uma nova versão do Worker com `wrangler versions upload --preview-alias <alias> --message "bohr" --tag "bohr-<commit>"`. Enviar uma versão **nunca muda o que a produção serve**.

- O alias vem do branch: letras minúsculas, dígitos e hífens, começando com uma letra, encurtado para que `<alias>-<worker>` caiba num rótulo DNS de 63 caracteres.
- A URL impressa é a URL de preview do alias, senão a URL de preview da própria versão.
- As homologações só têm endereço quando o Worker tem as URLs de preview ativadas (`"preview_urls": true` na configuração do wrangler dele). Sem elas, a CLI avisa e imprime a versão que enviou (`url` é `null` no [JSON](/pt-br/cli/json-output/#bohr-deploy)).

:::caution[D1 nas homologações]
Uma versão de homologação tem os mesmos bindings da produção: os [bancos D1](/pt-br/deploys/d1-databases/) dela **são os bancos da produção**, e as migrations do D1 não são aplicadas nas homologações. A homologação de uma mudança de schema roda contra o schema e os dados atuais da produção. Cuidado com homologações que gravam dados ou que dependem de uma migration.
:::

### Produção

```sh
bohr deploy --prod
```

1. Num terminal, ele pergunta `Deploy this folder to production (…) in the owner's Cloudflare account? [y/N]`; `--yes` pula a pergunta, e sem terminal ou com `--json` o próprio `--prod` é a confirmação.
2. **Migrations do D1**, como no workflow de deploy: `wrangler d1 migrations apply <binding> --remote` para cada banco D1 do `wrangler.jsonc` (ou `wrangler.json`) que declara um `migrations_dir` existente na pasta.
3. **Deploy**: `wrangler deploy --message "bohr" --tag "bohr-<commit>"`. Se o `.bohr/deploy.json` tem um comando `deploy` próprio, a produção roda esse comando no lugar, com as credenciais no ambiente dele, e o portão de proteção não é adicionado (como no workflow).

A bohr lê o nome do Worker da configuração do wrangler no branch de produção. Se a configuração do wrangler da pasta der outro nome de Worker, o `--prod` para antes do deploy com o código de saída 5 (`worker_mismatch`); uma homologação só avisa.

### Nunca tira um site do ar

- Uma homologação nunca toca a produção.
- Se uma migration do D1 falhar, o Worker não recebe o deploy: a produção continua servindo a versão anterior.
- Se o `wrangler deploy` falhar, a Cloudflare continua servindo a versão anterior.

### Commit e tag

A tag é `bohr-<os 12 primeiros caracteres do commit>` quando a árvore de trabalho não tem mudanças não commitadas em arquivos versionados. Senão, ela é `bohr-local`, e nenhum commit é registrado com o deploy.

### Credenciais e secrets

- O token da Cloudflare vai só para o ambiente dos processos do wrangler (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`). Ele nunca é impresso, registrado em log, colocado numa linha de comando nem gravado em disco, e as mensagens de erro o mostram como `***`. No GitHub Actions ele também é mascarado com `::add-mask::`.
- Toda vez que a instância entrega as credenciais, o log de auditoria dela registra o usuário, o token e o projeto. No máximo 30 por usuário e projeto em 10 minutos; acima disso a instância responde HTTP 429 (código de saída 1): espere alguns minutos.
- A bohr só entrega a conexão da Cloudflare do próprio dono, nunca o token da conta da própria bohr, e nunca para projetos que a bohr hospeda (esses continuam fazendo deploy pelo caminho de upload da bohr).

### Histórico

A CLI registra cada deploy na bohr: branch, produção ou homologação, nome do Worker, id da versão, URL e commit (`deploymentId` no JSON). Se o registro falhar, o deploy foi feito mesmo assim e a CLI só avisa. O painel ainda não mostra esses registros; os membros do projeto podem lê-los pela API da instância (`GET /api/projects/<id>/cli-deploys`). O painel da Cloudflare também lista as versões do Worker, com a mensagem `bohr` e a tag `bohr-…`.
