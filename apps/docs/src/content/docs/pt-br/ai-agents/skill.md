---
title: SKILL.md para agentes
description: Um arquivo de skill no formato de skills do Claude Code com tudo o que um agente de IA precisa para fazer deploy de projetos da bohr.
sidebar:
  order: 5
---

Uma **skill** é um arquivo de instruções que o agente carrega só quando precisa. Esta segue o formato de skills do Claude Code (uma pasta com um `SKILL.md` que começa com um `name` e uma `description`); outros agentes podem lê-la como instruções comuns.

**Download:** [SKILL.md](/pt-br/downloads/bohr-deploy/SKILL.md).

## Como instalar

No Claude Code, coloque-a numa pasta `bohr-deploy` das suas skills. O comando baixa o arquivo para um arquivo temporário e só o instala se ele for de fato a skill da bohr (começa com `---` e `name: bohr-deploy`), então um download que falhou ou veio errado nunca substitui uma skill que você já tem:

```sh
# para um repositório (faça commit para a sua equipe também receber); para todos os projetos
# do seu computador, use dir=~/.claude/skills/bohr-deploy
dir=.claude/skills/bohr-deploy
tmp=$(mktemp)
if curl -fsSL https://docs.bohr.io/pt-br/downloads/bohr-deploy/SKILL.md -o "$tmp" &&
  [ "$(head -n 2 "$tmp")" = "$(printf '%s\n%s' '---' 'name: bohr-deploy')" ]; then
  mkdir -p "$dir" && mv "$tmp" "$dir/SKILL.md" && echo "Instalado em $dir/SKILL.md"
else
  rm -f "$tmp"; echo "O download não é a skill da bohr: nada foi instalado." >&2
fi
```

Outros agentes: salve o arquivo em qualquer lugar e aponte para ele no seu arquivo de instruções, ou cole-o nas instruções do agente.

## O arquivo

<!-- download:start -->

````markdown
---
name: bohr-deploy
description: Faz deploy de um projeto da bohr (bohr.io) com a CLI do bohr. Use quando o usuário pedir para fazer deploy, publicar, gerar uma homologação (preview) ou colocar no ar um site que faz deploy com a bohr, quando o repositório tiver uma pasta .bohr/ (.bohr/deploy.json, .bohr/project.json), ou quando BOHR_TOKEN estiver definida.
---

# Deploy de projetos da bohr

A bohr (https://docs.bohr.io/pt-br/) faz deploy de repositórios do GitHub como Cloudflare Workers. A CLI `bohr` (pacote npm `bohr`, Node.js 20+) faz deploy de um projeto a partir desta máquina: homologações de qualquer branch, e produção para os donos do projeto.

## Regras

1. Use só a CLI do bohr para fazer deploy, sempre de forma não interativa e com `--json`:
   `npx --yes bohr@latest <command> --json`
   O stdout é exatamente um objeto JSON. Logs e a saída do build vão para o stderr.
2. Autentique com a variável de ambiente `BOHR_TOKEN`. Nunca imprima, registre em log, faça commit ou dê echo no token, e nunca o coloque numa linha de comando. Se ele estiver faltando, peça ao usuário para criar um no painel da bohr (Conta › Tokens), limitado a este projeto, e defini-lo como `BOHR_TOKEN`.
3. Faça deploy de **homologações** por padrão. Faça deploy de **produção** (`--prod`) só quando o usuário tiver pedido explicitamente um deploy de produção nesta conversa.
4. Nunca faça commit de secrets nem de arquivos `.env`. Coloque os secrets no painel da bohr (Configurações › Variáveis de ambiente), não no `wrangler.jsonc`.
5. Não edite `.github/workflows/bohr-deploy.yml` (a bohr gera esse arquivo a partir do `.bohr/deploy.json`).

## Passos

### 1. Encontre o projeto (uma vez por sessão)

```sh
npx --yes bohr@latest projects --json
```

Escolha o projeto cujo `repository` (`owner/name`) corresponde ao remote do GitHub deste repositório. Guarde o `id` dele.

- `mode: "managed"`: a bohr hospeda o projeto; o `bohr deploy` o publica.
- `mode: "byo"`: ele roda na conta Cloudflare do dono; o `bohr deploy` o publica com o wrangler, só para os donos (veja "Projetos na conta Cloudflare do dono").
- `role: "owner"` é necessário para produção, e para qualquer deploy de um projeto `byo`.

Como alternativa, se o repositório tiver `.bohr/project.json`, a CLI já sabe qual é o projeto e dá para omitir `--project`.

### 2. Faça deploy de uma homologação depois de cada mudança

```sh
npx --yes bohr@latest deploy --project <id> --branch <branch> --json
```

- Use um nome de branch descritivo, por exemplo `agent/<short-description>`. Ele não precisa existir no git.
- A CLI roda primeiro o install e o build do `.bohr/deploy.json`. Adicione `--no-build` só se você já fez o build do site neste ambiente.
- Em caso de sucesso, leia a `url` e entregue ao usuário. Também são úteis: `deploymentId`, `files`, `uploadedFiles`.

Exemplo de sucesso:

```json
{"ok":true,"url":"https://agent-fix-form-shop-acme.bohr.io","deploymentId":"d_…","project":{"id":"p3k9x0a7qd2m","name":"shop"},"branch":"agent/fix-form","production":false,"files":42,"bytes":1363148,"uploadedFiles":3,"uploadedBytes":20480,"modules":1}
```

### 3. Produção (só quando pedirem)

```sh
npx --yes bohr@latest deploy --project <id> --prod --json
```

## Como tratar o resultado

Em caso de falha, o stdout é `{"ok":false,"error":{"code","message","exitCode"}}` e o processo sai com `exitCode`. Decida com base no código de saída e em `error.code`:

| Saída | Significado | O que fazer |
| --- | --- | --- |
| 0 | Pronto | Informe a `url`. |
| 1 | Falhou (build, upload, wrangler, migration do D1, rede, instância, `rate_limited`) | Leia `error.message` e o log do stderr. Corrija um erro de build e tente de novo uma vez. Para `network_error`, tente de novo uma vez depois de uma breve espera. Para `rate_limited`, pare e diga ao usuário para esperar alguns minutos. |
| 2 | Uso errado (`usage`, `no_project`, `no_branch`, `invalid_deploy_config`, `invalid_link`) | Corrija o comando ou o arquivo citado na mensagem. Para `no_branch`, passe `--branch`. |
| 3 | Não entrou ou token rejeitado (`not_signed_in`, `invalid_token`, `http_401`) | Pare. Peça ao usuário um `BOHR_TOKEN` válido. Não tente `bohr login` (ele precisa de uma pessoa e de um navegador). |
| 4 | Não encontrado (`project_not_found`, `not_a_v2_project`, `no_address`) | Confira de novo `projects --json` e os projetos do token. `not_a_v2_project` significa que esta pasta não é um projeto da bohr v2 (talvez um repositório da bohr v1): pare e avise o usuário. |
| 5 | Não permitido (`own_account_not_allowed`, `production_not_allowed`, `production_on_v1`, `worker_mismatch`, `suspended`, `http_403`, `own_account`) | Não tente de novo. Diga ao usuário o motivo. Para `production_not_allowed` ou `production_on_v1`, faça deploy de uma homologação. Para `own_account_not_allowed`, veja abaixo. `own_account` só vem de uma CLI desatualizada: rode `npx --yes bohr@latest`. |

## Projetos na conta Cloudflare do dono (`mode: "byo"`)

O `bohr deploy` faz o deploy deles com o wrangler, usando o token da Cloudflare que o dono conectou à bohr. O resultado tem `"mode": "byo"`, mais `versionId`, `previewUrl`, `workerName` e `commitSha` (as contagens do upload são `null`).

- Só os donos do projeto (admins da organização dele) podem fazer deploy deles, homologações incluídas. Qualquer outra pessoa recebe o código de saída 5 com `own_account_not_allowed`: não faça push no branch de produção você mesmo; faça commit da sua mudança num branch, faça push dele, abra um pull request para o branch de produção e deixe uma pessoa revisar e fazer o merge. O próprio agente da bohr do projeto (no painel da bohr ou no Telegram) também pode fazer a mudança, com uma homologação.
- Uma homologação envia uma nova versão do Worker e nunca muda a produção. Se `url` for `null`, o Worker não tem URLs de preview: diga ao usuário para definir `"preview_urls": true` na configuração do wrangler dele.
- As homologações usam os **bancos D1 da produção** e não aplicam migrations do D1. Pergunte ao usuário antes de fazer deploy de uma homologação que grava dados ou depende de uma mudança de schema.
- `--prod` aplica as migrations do D1 e depois faz o deploy. `worker_mismatch` significa que a configuração do wrangler da pasta dá outro nome de Worker que não o do projeto: nada recebeu deploy; avise o usuário.

## Arquivos úteis

- `.bohr/deploy.json`: como a produção é construída (`directory`, `node`, `packageManager`, `install`, `build`, `deploy`, `secrets`).
- `.bohr/preview.json`: como roda o servidor de desenvolvimento da homologação (`install`, `command`, `port`, `env`).
- `wrangler.jsonc`: o Worker. Projetos que a bohr hospeda suportam só assets estáticos, `vars` e secrets; outros bindings fazem o deploy falhar.
- Arquivos estáticos com mais de 25 MiB não podem ir no deploy. Arquivos `.git` e `.env*` nunca são publicados.

Docs: https://docs.bohr.io/pt-br/ai-agents/overview/ (Markdown: https://docs.bohr.io/pt-br/llms.txt)
````

<!-- download:end -->
