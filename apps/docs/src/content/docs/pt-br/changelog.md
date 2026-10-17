---
title: Histórico de mudanças
description: O que mudou na bohr, versão por versão, a partir da bohr v2.
---

## CLI 4.1.0

- O `bohr deploy` faz deploy de projetos na sua própria conta da Cloudflare, para os donos deles (admins da organização): homologações como versões do Worker com um alias de preview por branch, produção com as migrations do D1 primeiro, as duas com o wrangler e as variáveis do build guardadas na bohr. Os membros recebem o código de saída 5 (`own_account_not_allowed`). Veja [Projetos na sua própria conta da Cloudflare](/pt-br/cli/deploy/#projetos-na-sua-própria-conta-da-cloudflare).
- O resultado `--json` do `bohr deploy` tem `mode` (`managed` ou `byo`); os deploys na sua própria conta acrescentam `versionId`, `previewUrl`, `workerName` e `commitSha`.
- `own_account` (código de saída 5) agora só vem da CLI 4.0.0 e anteriores: atualize com `npx bohr@latest`.

## 2.0.0

bohr v2: a bohr reescrita como uma plataforma de deploy open source e auto-hospedada, operada por um agente de IA.

### O agente

- Um agente de IA muda o seu site por conversa, no painel web ou em um bot do Telegram por projeto.
- Toda mudança vai primeiro para a homologação (branch `homolog`); **Aprovar e publicar** faz o merge para a produção, **Descartar** joga fora, e a reversão desfaz a última publicação.
- Provedores de modelo: uma chave da API da Anthropic, qualquer endpoint compatível com a Messages API da Anthropic, ou uma assinatura Claude Pro/Max.
- Orçamento e máximo de turnos por pedido, modelo e idioma por projeto.

### Projetos

- Os projetos rodam na conta da Cloudflare do dono, com deploy feito por um workflow do GitHub Actions que a bohr escreve a partir do `.bohr/deploy.json`, com credenciais entregues na hora da execução via GitHub OIDC.
- Novos projetos a partir de seis modelos (Lista de espera, Agendamentos, Link na bio, Formulários e pesquisas, Cardápio digital, Links curtos), com um banco de dados D1.
- Variáveis do site e do build, proteção por senha com Basic Auth, domínios próprios, builds e versões no painel.
- Membros com códigos de convite de uso único; organizações que espelham organizações do GitHub, com assinatura, conta da Cloudflare e agente próprios.

### Ferramentas de deploy

- A CLI `bohr` 4.0.0 (`npx bohr`; as versões 2.x e 3.x no npm são de um pacote de 2016 sem relação, que usava o nome): `login`, `logout`, `whoami`, `projects`, `link`, `open` e `deploy`, com saída `--json` e códigos de saída estáveis para scripts e agentes de IA.
- Tokens em **Conta › Tokens**, restritos a projetos e com validade.
- `bohr-io/deploy-action@v1` roda a CLI no GitHub Actions.

### Rodando a bohr

- Auto-hospedagem com o botão Deploy to Cloudflare, telemetria anônima opcional.
- bohr.io Cloud em app.bohr.io por US$20/mês por conta ou organização.
- Os projetos da bohr v1 continuam fazendo deploy pelo workflow deles, hospedados pela bohr até que os donos os movam para a própria conta da Cloudflare.
