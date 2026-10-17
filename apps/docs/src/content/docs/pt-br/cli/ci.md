---
title: Uso em CI
description: Rode bohr deploy no GitHub Actions e em outros sistemas de CI.
sidebar:
  order: 7
---

A CLI percebe quando está em CI: sem terminal, ou com `CI` definida, ela nunca faz perguntas e nunca abre o navegador.

## GitHub Actions com OIDC (sem secret)

Com `permissions: id-token: write` e sem `BOHR_TOKEN`, a CLI entra com o token OIDC do GitHub da execução e faz deploy do repositório da execução e do branch que recebeu o push:

```yaml
name: Deploy
on: { push: { branches: ['**'] } }
permissions: { contents: read, id-token: write }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 22 }
      - id: bohr
        run: npx --yes bohr@latest deploy
      - run: echo "Deployed to ${{ steps.bohr.outputs.url }}"
```

- A CLI roda primeiro o install e o build do `.bohr/deploy.json` (adicione `--no-build` se um step anterior já fez o build do site).
- No GitHub Actions a CLI escreve os step outputs `url` e `deployment-id`, mascara secrets com `::add-mask::` e agrupa o log.
- `--prod`, `--branch` e `--project` precisam de `BOHR_TOKEN`: com OIDC, quem decide é o branch da execução.
- Workflows disparados a partir de forks nunca recebem tokens OIDC.

É isso que a [`bohr-io/deploy-action@v1`](/pt-br/github-action/reference/) faz também.

## Com um token (qualquer CI)

Crie um token em **Conta › Tokens** limitado ao projeto, guarde como secret do CI e passe como `BOHR_TOKEN`:

```yaml
      - run: npx --yes bohr@latest deploy --project p3k9x0a7qd2m --branch "$GITHUB_REF_NAME" --json
        env:
          BOHR_TOKEN: ${{ secrets.BOHR_TOKEN }}
```

GitLab CI, com `BOHR_TOKEN` definida como uma variável de CI/CD mascarada:

```yaml
deploy:
  image: node:22
  script:
    - npx --yes bohr@latest deploy --project p3k9x0a7qd2m --branch "$CI_COMMIT_REF_NAME" --json
```

Produção a partir do CI precisa de um token de um **dono** do projeto e de `--prod` (sem terminal, nenhuma pergunta é feita):

```sh
BOHR_TOKEN=bohr_… npx --yes bohr@latest deploy --prod --json
```

## Detecção do branch

Sem `--branch`, a CLI usa o branch em checkout; num HEAD destacado (comum em CI) ela recorre a `GITHUB_HEAD_REF` e depois a `GITHUB_REF`. Em outros lugares, passe `--branch` explicitamente.

## Fixar uma versão

`npx bohr@latest` sempre roda a versão mais recente. Para fixar uma, use `npx --yes bohr@4.1.0 deploy`, ou adicione `bohr` às suas `devDependencies`.

:::note
Com `BOHR_TOKEN`, deploys pelo CI também alcançam projetos na sua própria conta da Cloudflare, quando o token é de um dono ([como eles fazem deploy](/pt-br/cli/deploy/#projetos-na-sua-própria-conta-da-cloudflare)); no GitHub Actions os step outputs `url` e `deployment-id` também são escritos. Com OIDC (sem `BOHR_TOKEN`), a CLI só faz deploy de projetos que a bohr hospeda: projetos na sua própria conta da Cloudflare fazem deploy pelo [workflow de deploy](/pt-br/deploys/deploy-workflow/) deles.
:::
