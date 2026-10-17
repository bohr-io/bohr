---
title: Solução de problemas
description: Erros comuns, com as mensagens exatas que a bohr mostra, e como resolvê-los.
sidebar:
  order: 2
---

## Login

| Mensagem | Solução |
| --- | --- |
| *Esta instância ainda não foi configurada* | Auto-hospedagem: o administrador precisa concluir o `/setup` ([app do GitHub](/pt-br/self-hosting/github-app/)). |
| *Muitas tentativas. Aguarde alguns minutos e tente de novo.* | Códigos por e-mail demais ou códigos errados demais. Espere uns 15 minutos. |
| *O código venceu ou foi digitado errado vezes demais. Peça um novo código.* | Os códigos valem 10 minutos e permitem 5 tentativas. |
| *Este e-mail já pertence a outra conta da bohr.* | Entre com essa outra conta, ou use outro endereço. |

## Conectando a Cloudflare

| Mensagem | Solução |
| --- | --- |
| *Isso não parece um token da API da Cloudflare.* | Copie o token inteiro, sem espaços. |
| *Cloudflare did not accept this token.* / *This token is …* | O token é inválido, venceu ou está desativado. Crie outro. |
| *O token não tem todas as permissões* | Edite o token e adicione o que estiver listado. Veja [Conectar a Cloudflare](/pt-br/getting-started/connect-cloudflare/#criar-o-token). |
| *This token cannot see any Cloudflare account.* | Dê ao token acesso à sua conta (Account Resources). |
| *Paste the Cloudflare token again.* | Você levou mais de 15 minutos para escolher uma conta. Cole o token de novo. |
| *O token da Cloudflare não pode criar bancos de dados D1.* | Projetos criados a partir de um modelo precisam de **D1: Edit**. Edite o token e tente de novo. |

## Configuração do projeto

| Mensagem | Solução |
| --- | --- |
| *This Cloudflare account has no workers.dev subdomain yet. Open Workers & Pages in the Cloudflare dashboard once to create it, then try again.* | Faça isso e depois use a opção de tentar de novo na página do projeto. |
| *… is already a bohr project.* | Um repositório só pode ser um projeto. Procure-o em **Projetos** (ou numa organização). |
| *The GitHub App cannot reach that repository.* | [Dê ao app acesso](/pt-br/getting-started/install-github-app/#dar-acesso-a-mais-repositórios) ao repositório. |
| *Para criar projetos no bohr.io Cloud, você precisa de uma assinatura ativa.* | [Assine](/pt-br/billing/subscription/), ou peça a um admin da organização para assinar. |
| *The Cloudflare account already has a Worker named … Choose another project name.* | Projetos criados a partir de um modelo: escolha outro nome. |
| *GitHub is taking too long to copy the template.* | O repositório foi criado; espere um minuto e crie o projeto a partir dele como repositório. |
| *Falha na configuração* com outro motivo | Confira as permissões do token e tente de novo. |

## O agente

| Mensagem | Solução |
| --- | --- |
| *O agente está desligado porque ainda não tem um provedor.* | O dono (ou o admin da organização) define um [provedor de modelo](/pt-br/agent/providers/). |
| Auto-hospedada: o painel do projeto avisa que o agente precisa do **Workers Paid** | A conta da Cloudflare não pode rodar o sandbox do agente (um Container). O site, os deploys e os domínios continuam funcionando. Passe a conta para o Workers Paid e adicione **Containers: Edit** ao token (ou conecte a conta de novo com um token novo); depois abra o projeto e clique em **Verificar de novo**. Veja [Onde o agente roda](/pt-br/getting-started/connect-cloudflare/#onde-o-agente-roda). |
| *That does not look like an Anthropic API key (sk-ant-…).* | As chaves da Anthropic começam com `sk-ant-`. Um token `sk-ant-oat01-` é um token de assinatura Claude: escolha **Assinatura Claude**. |
| *The provider did not accept this key.* / *Could not reach …* | Confira a chave e a **URL base** de um provedor compatível (sem `/v1/messages`). |
| *o orçamento do pedido (US$…) acabou antes de o trabalho terminar* | Aumente o **Orçamento por pedido** em **Configurações › Agente**, ou divida o pedido. |
| *o ambiente do agente reiniciou no meio do pedido* | Acontece durante atualizações da bohr. Mande o pedido de novo; uma preparação do repositório interrompida recomeça sozinha uma vez. |
| *Você já tem 5 pedidos na fila.* | Espere, ou cancele um com `/cancelar`. |
| *A mensagem é longa demais.* | Os pedidos têm limite de 20.000 caracteres. Divida-o. |

## A homologação

| Mensagem | Solução |
| --- | --- |
| *A homologação ainda não está configurada: o agente prepara isso ao importar o repositório.* | Espere a preparação do repositório, ou clique em **Preparar o repositório** no chat. |
| *A homologação não conseguiu iniciar. Peça ao agente para verificar o arquivo .bohr/preview.json.* | Abra **Status e log da homologação** para ver o erro e peça ao agente para corrigi-lo. Veja [.bohr/preview.json](/pt-br/deploys/preview-json/). |
| *A homologação está iniciando. Esta página recarrega sozinha.* | O sandbox estava dormindo e está instalando as dependências. Pode levar alguns minutos. |
| *A homologação está rodando, mas o servidor dela não respondeu.* | O servidor de desenvolvimento precisa escutar em `0.0.0.0` na porta configurada e aceitar qualquer header `Host`. |

## Deploys

| Mensagem | Solução |
| --- | --- |
| *O deploy de produção falhou. Veja os detalhes: …* | Abra a execução em [Builds](/pt-br/projects/builds/) e peça ao agente para corrigir o erro. A produção mantém a versão anterior. |
| *O arquivo .bohr/deploy.json tem um problema (…), então o deploy de produção não foi atualizado.* | Peça ao agente para corrigi-lo, ou corrija manualmente ([referência](/pt-br/deploys/deploy-json/)). |
| `Deploy credentials are only given to .github/workflows/bohr-deploy.yml on <branch>.` | Só esse workflow, num push para o branch de produção, recebe credenciais. |
| `Could not get a GitHub OIDC token` | O workflow precisa de `permissions: id-token: write`. |
| *A proteção não vale para este site* | O projeto usa um comando `deploy` próprio; veja [Proteção por senha](/pt-br/projects/password-protection/). |

## CLI

| Mensagem | Solução |
| --- | --- |
| `Not signed in to … Run "bohr login", or set BOHR_TOKEN…` | Faça login, ou defina um token ([Autenticação](/pt-br/cli/authentication/)). |
| `… The token expired or was revoked…` | Crie um novo token, ou rode `bohr login` de novo. |
| `… runs in its owner's Cloudflare account, and deploys from the CLI only reach projects bohr hosts for now.` | Uma CLI desatualizada (4.0.0 ou anterior): rode `npx bohr@latest` ([detalhes](/pt-br/cli/deploy/#quais-projetos)). |
| `… runs in its owner's Cloudflare account: only its owners (admins of its organization) can deploy it from the CLI…` | Só os donos fazem deploy desses projetos pela CLI. Faça push num branch, ou peça a um dono ([detalhes](/pt-br/cli/deploy/#quem-pode-fazer-deploy)). |
| `wrangler printed no preview address: turn on preview URLs for the Worker…` | Defina `"preview_urls": true` na configuração do wrangler do Worker ([detalhes](/pt-br/cli/deploy/#homologações)). |
| `This folder's wrangler config deploys the Worker "…", but …'s site is "…"` | Rode na pasta do Worker do projeto, ou corrija o `name` na configuração do wrangler. |
| `This repository is not a bohr v2 project: …` | Rode na pasta do projeto, vincule-a com `bohr link` ou adicione uma configuração do wrangler. Repositórios da bohr v1 nunca são alterados. |
| `Which project? … has no GitHub remote (origin).` | Passe `--project <id>` ou rode `bohr link`. |
| `Which branch? HEAD is detached: pass --branch <name>.` | Passe `--branch`. |
| `Asset too large: …` | A Cloudflare aceita arquivos de até 25 MiB: remova o arquivo ou liste-o no `.assetsignore`. |
| `Found wrangler.toml, but this action reads wrangler.jsonc.` | Converta a configuração para `wrangler.jsonc`. |

Todos os códigos da CLI: [Códigos de saída e erros](/pt-br/cli/exit-codes/).

## Domínios e variáveis

| Mensagem | Solução |
| --- | --- |
| *O site ainda não foi publicado* / `The site's Worker (…) is not deployed yet.` | Domínios e variáveis do site precisam do Worker do site: publique uma vez. |
| `No zone in your Cloudflare account covers … Add the domain to Cloudflare first.` | Adicione a zona do domínio à conta em que o projeto roda. |
| *… é um nome que a bohr ou o GitHub já usam.* | Nomes que começam com `GITHUB_`, `CLOUDFLARE_`, `BOHR_`, e `CI`, são reservados. |
| `… is already set in the site's wrangler config: change it there.` | Remova-a de `vars` no `wrangler.jsonc`, ou mude-a lá. |

Ainda com problemas? [Discord](https://discord.com/invite/p3hhfGg2Uy) ou [contact@bohr.io](mailto:contact@bohr.io).
