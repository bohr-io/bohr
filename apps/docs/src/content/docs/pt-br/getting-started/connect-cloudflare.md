---
title: Conectar a Cloudflare
description: Crie o token de API da Cloudflare de que a bohr precisa, com as permissões certas, e conecte a sua conta.
sidebar:
  order: 2
---

A bohr faz o deploy dos seus projetos na **sua** conta da Cloudflare, com um token de API que você fornece: o site de produção, os deploys de homologação, as rotas e os domínios próprios. Quando a conta pode rodar Containers, o Worker de cada projeto, o sandbox do agente e a homologação também rodam ali (veja [Onde o agente roda](#onde-o-agente-roda)). A instância guarda o token criptografado e só o usa para criar e atualizar os Workers dos seus projetos.

## Antes de começar

- Qualquer plano serve, inclusive o gratuito. Só o sandbox do agente, um Cloudflare Container, precisa do plano **Workers Paid**: no bohr.io Cloud uma conta gratuita basta, e numa instância auto-hospedada o agente precisa do Workers Paid na sua conta.
- A conta precisa de um **subdomínio workers.dev**. Se você nunca abriu **Workers & Pages** no painel da Cloudflare, abra uma vez: isso cria o subdomínio.

## Criar o token

1. No passo **Cloudflare**, clique em **Criar o token na Cloudflare**. Isso abre a página de tokens da Cloudflare com as permissões preenchidas.
2. Opcional: se a conta está no Workers Paid e você quer que o agente rode nela, adicione a permissão `Containers: Edit` antes de salvar. O link não consegue preenchê-la.
3. Crie o token, copie, cole em **Token da API da Cloudflare** e clique em **Conectar**.

O token precisa destas permissões:

| Permissão | Por quê |
| --- | --- |
| **Workers Scripts: Edit** | Cria os Workers dos projetos. Também cobre Durable Objects e o subdomínio workers.dev. |
| **Account Settings: Read** | Lê os dados da conta. |
| **D1: Edit** | Cria o banco de dados dos projetos criados a partir de um [modelo](/pt-br/getting-started/templates/). Já vem preenchida pelo link; só projetos de modelo precisam dela. |
| **Workers Routes: Edit** | Serve por uma rota de Worker um domínio que já tem registros DNS, quando um projeto [vai para a sua conta](/pt-br/migrating-from-v1/move-to-your-cloudflare/). Já vem preenchida pelo link. |
| **Containers: Edit** | Opcional. Roda o sandbox do agente na sua própria conta; precisa do plano Workers Paid. **Adicione à mão.** |

Quando falta alguma coisa, o painel mostra *"O token não tem todas as permissões"* com a lista. Edite o token na Cloudflare (ou crie outro pelo modelo), adicione o que falta e cole de novo.

### Onde o agente roda

A bohr confere se a conta pode rodar Containers (Workers Paid, e **Containers: Edit** no token) quando prepara o agente de um projeto: quando o projeto é criado ou quando o agente é ligado.

- **Se pode:** o Worker do projeto, o sandbox do agente e a homologação rodam na sua conta.
- **Se não pode, no bohr.io Cloud:** eles rodam na conta da Cloudflare da bohr, cobertos pela [assinatura](/pt-br/billing/subscription/). O seu site de produção, os deploys de homologação, as rotas e os domínios continuam indo para a sua conta, com o seu token.
- **Se não pode, numa instância auto-hospedada:** o projeto funciona sem o agente. Os deploys de produção (o [workflow de deploy](/pt-br/deploys/deploy-workflow/) ou o [`bohr deploy`](/pt-br/cli/deploy/)), os deploys de homologação e os domínios funcionam, e o painel do projeto avisa que o agente precisa do Workers Paid. Depois de passar a conta para o Workers Paid e adicionar Containers: Edit ao token (ou conectar a conta de novo com um token novo), abra o projeto e clique em **Verificar de novo**.

Um projeto cujo agente já está preparado continua rodando onde está.

### Várias contas

Se o token enxerga mais de uma conta da Cloudflare, a bohr pede **Escolha a conta da Cloudflare**: escolha aquela em que os seus projetos devem rodar e clique em **Usar esta conta**.

## O que a bohr deixa na sua conta

Para você distinguir o trabalho da bohr do seu:

- Toda chamada à API da Cloudflare que a bohr faz envia `User-Agent: bohr/<version> (+https://bohr.io)`; isso aparece no audit log da sua conta.
- Os Workers que a bohr cria na sua conta (o Worker do agente e o Worker da homologação de cada projeto) levam as tags `bohr` e `bohr-project:<id>`, e os deployments deles a mensagem `bohr`.
- Os deploys de produção rodam `wrangler deploy --message "bohr" --tag "bohr-<commit>"`.

## Depois

- As contas conectadas ficam listadas em **Conta › Contas conectadas › Cloudflare**. Você pode [desconectar](/pt-br/account/connections/) uma conta quando nenhum projeto a usar mais; apague também o token no painel da Cloudflare (**My Profile → API Tokens**).
- Uma [organização](/pt-br/organizations/settings-and-billing/) conecta a própria conta da Cloudflare, separada da sua.
