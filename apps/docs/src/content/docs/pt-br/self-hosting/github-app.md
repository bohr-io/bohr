---
title: O app do GitHub da instância
description: Crie o app do GitHub que a sua instância usa, e as permissões que ele pede.
sidebar:
  order: 3
---

Toda instância tem o próprio app do GitHub, criado a partir de um manifest em `/setup`. A bohr o usa para fazer o login das pessoas com o GitHub, ler repositórios, fazer push do trabalho do agente, abrir e fazer merge de pull requests, e escrever o workflow de deploy.

## Criar o App

1. Abra `https://<your instance>/setup`.
2. Preencha:
   - **Admin token**: o secret `ADMIN_TOKEN`.
   - **App name**: até 34 caracteres, único no GitHub (padrão `bohr <your host>`).
   - **GitHub organization (optional)**: para criar o App como propriedade de uma organização em vez da sua conta.
   - **Other people can install it**: deixe marcado se outros usuários vão trazer os próprios repositórios.
3. Clique em **Create the GitHub App**. O GitHub mostra as permissões; confirme.

O GitHub volta para a instância, que guarda as credenciais do App no cofre. Depois disso, o `/setup` mostra o App e um link para instalá-lo.

Para usar outro App mais tarde, apague a configuração `github_app` no banco de dados da instância e abra o `/setup` de novo.

## Permissões

| Permissão | Por quê |
| --- | --- |
| Contents: write | O agente faz push no branch `homolog`; as aprovações fazem merge para a produção |
| Pull requests: write | As aprovações abrem pull requests e fazem merge deles; os rollbacks abrem pull requests de revert |
| Workflows: write | O Worker do projeto escreve o workflow de deploy (o token do próprio sandbox nunca recebe essa permissão) |
| Secrets: write | Variáveis do build dos projetos que a bohr hospeda, e a remoção de secrets do Actions que versões antigas escreveram. O token da Cloudflare dos projetos em conta própria nunca é guardado no GitHub. |
| Actions: read | Avisa quando o deploy de produção termina; a página Builds |
| Metadata: read | Exigida pelo GitHub |
| Organization › Members: read | As organizações na bohr espelham os membros da organização no GitHub |
| Administration: write | Cria repositórios a partir de modelos (novos projetos a partir de um modelo, só com a autorização do próprio usuário) |

Eventos:

| Evento | Por quê |
| --- | --- |
| **Organization** | Membros adicionados a uma organização do GitHub ou removidos dela: os membros da organização na bohr acompanham |
| **Push**, **Pull request** | Assinados desde a primeira versão; a bohr confirma o recebimento e não faz nada com eles hoje (os deploys rodam pelo workflow do repositório) |

Os eventos **Installation** chegam a todo App sem precisar de assinatura: a bohr registra cada instalação e liga a instalação de uma organização do GitHub à organização dela na bohr.

O webhook vai para `https://<your instance>/api/github/webhook`; numa instância local (`http://localhost`), o webhook fica desligado.

## Apps criados por versões antigas

- **Organizações** precisam da permissão de organização **Members** (somente leitura) e do evento **Organization**. Adicione-os nas configurações do App no GitHub (*Permissions & events*); depois, cada organização do GitHub aceita a nova permissão. Até isso acontecer, a bohr só adiciona quem instalou o App, e o painel pede a permissão.
- **Modelos** precisam da permissão de repositório **Administration** (leitura e escrita). Cada conta que instalou o App a aceita uma vez. Até lá, o GitHub se recusa a criar o repositório, e o painel avisa.

## Usar um App existente

Em vez do `/setup`, uma instância pode ler o App a partir de secrets: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` e `GITHUB_WEBHOOK_SECRET`. Veja [Configuração](/pt-br/self-hosting/configuration/).
