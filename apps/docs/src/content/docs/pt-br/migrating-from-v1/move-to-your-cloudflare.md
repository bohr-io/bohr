---
title: Mover para a sua conta da Cloudflare
description: Mova um projeto que a bohr hospeda para a sua própria conta da Cloudflare, com os secrets e os domínios dele.
sidebar:
  order: 3
---

Os projetos da bohr v2 rodam na conta da Cloudflare do dono. Um projeto migrado da v1 pode ir para lá quando você quiser: você ganha todos os recursos da Cloudflare (D1, KV, R2, Durable Objects, cron triggers…) e controle total dos seus domínios.

## Antes de começar

- Uma conta da Cloudflare conectada à bohr (ou conecte uma durante a mudança). O plano gratuito basta. Veja [Conectar a Cloudflare](/pt-br/getting-started/connect-cloudflare/).
- Para cada domínio próprio que deve ir sem ficar fora do ar, a **zona dele nessa conta da Cloudflare** (nameservers apontando para a Cloudflare). Um domínio que já tem registros DNS ali é servido por uma rota de Worker, o que exige **Workers Routes: Edit** no token (o link do token já preenche essa permissão).
- Só o dono do projeto (ou um admin da organização dele) pode movê-lo.

## Como funciona

1. A bohr abre um pull request no seu repositório que muda o deploy para a sua conta da Cloudflare, com as configurações de build e os arquivos de que ele precisa, e remove o workflow da bohr v1.
2. Depois do merge, o GitHub Actions publica o site na sua conta, e a bohr copia os secrets e move os seus domínios.
3. Os endereços bohr.io passam a redirecionar para o novo endereço do site.

O deploy pega o token da Cloudflare na bohr na hora da execução, nunca no repositório.

## Passo a passo

1. Abra **Configurações › Hospedagem** do projeto.
2. Em **Conta da Cloudflare de destino**, escolha uma conta, ou **Conectar outra conta**.
3. Clique em **Preparar a mudança** e confirme. A bohr abre um pull request (branch `bohr/move-to-cloudflare`) que deixa o repositório fazendo deploy na sua conta sozinho. O site só muda depois do merge. O pull request:
   - escreve o [workflow de deploy](/pt-br/deploys/deploy-workflow/) (`.github/workflows/bohr-deploy.yml`): `wrangler deploy` para a sua conta nos pushes para o branch de produção;
   - adiciona o `.bohr/deploy.json` quando o repositório não tem um, com os comandos de install e build e a versão do Node.js com que a bohr fazia o build do site, e os arquivos que a bohr gerava a cada deploy (`wrangler.jsonc`, os arquivos em `.bohr/`);
   - escreve o nome do Worker e as suas variáveis de produção comuns (não secretas) no `wrangler.jsonc`;
   - quando o site é servido direto da pasta do projeto (sem pasta de saída do build), adiciona um `.assetsignore` nela se não houver um, para o `wrangler deploy` não publicar arquivos privados (`.git`, `.env*`, `node_modules`, `.github`, `.bohr`, `wrangler.json*`) nem o que a bohr v1 nunca publicava (`package.json`, lockfiles, `/api/`…). Um `.assetsignore` que você já tem fica como está;
   - remove o workflow da bohr v1 (`bohr.yml`, que roda o `bohr-io/action`), para o site parar de fazer deploy na hospedagem da bohr.
4. Revise e faça o merge do pull request no GitHub (**Abrir #N no GitHub**).
5. Espere o deploy do GitHub Actions terminar.
6. Volte e clique em **Concluir a mudança**.

**Concluir a mudança** confere o merge e o novo Worker, depois copia os secrets para ele, liga os seus domínios próprios cujas zonas estão na sua conta e aponta os endereços bohr.io para o novo lugar. As variáveis de build continuam guardadas na bohr: o workflow de deploy as recebe na hora da execução. Se aparecer *"Ainda não dá para concluir"*, confira se o pull request foi mergeado e se o deploy terminou, e tente de novo.

## Os endereços depois da mudança

| Situação | Significado |
| --- | --- |
| **Na sua conta** | O domínio agora aponta para o Worker na sua conta |
| **Redireciona** | Os endereços bohr.io redirecionam (301) para o novo endereço do site |
| **Pendente** | A zona do domínio ainda não está na sua conta. Adicione-a, aponte os nameservers para a Cloudflare e clique em **Concluir a mudança** de novo. Até lá, o domínio continua mostrando a última versão publicada pela bohr. |
| **Desativado** | Os endereços de homologação dos branches não recebem mais deploy: na sua conta, as homologações vêm do agente |

Quando não há nada pendente: *"Pronto! O projeto agora roda na sua conta da Cloudflare."* A partir daí, ele é um projeto comum da bohr v2: [domínios](/pt-br/projects/domains/), [variáveis](/pt-br/projects/variables/) e o [workflow de deploy](/pt-br/deploys/deploy-workflow/) funcionam como em qualquer projeto na sua conta. Se o agente estava ligado, ele continua funcionando: o sandbox fica onde foi criado e, daqui em diante, faz deploy na sua conta.

## Quando a mudança não pode ser preparada automaticamente

Alguns repositórios não podem ser movidos automaticamente, por exemplo quando o `.github/workflows/bohr-deploy.yml` é um workflow que a bohr não escreveu, ou quando os comandos de build não cabem no `.bohr/deploy.json` (um comando em várias linhas). O painel então diz *"Não foi possível preparar a mudança automaticamente."* Fale com a gente no [Discord](https://discord.com/invite/p3hhfGg2Uy) ou em [contact@bohr.io](mailto:contact@bohr.io): ajudamos você a mudar a etapa de deploy manualmente.
