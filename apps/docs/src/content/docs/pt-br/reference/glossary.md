---
title: Glossário
description: As palavras que a bohr usa, em inglês e no painel em português.
sidebar:
  order: 1
---

| Termo | Em inglês | Significado |
| --- | --- | --- |
| **Instância** | Instance | O plano de controle da bohr: o painel, a API e o cofre de credenciais. O bohr.io Cloud é uma; você pode [hospedar a sua](/pt-br/self-hosting/overview/). |
| **Projeto** | Project | Um repositório do GitHub, o site de produção dele e o agente dele. |
| **Worker do projeto** | Project Worker | O Worker que a bohr cria na conta da Cloudflare do dono para cada projeto: a fila de pedidos, os membros, o chat, o bot do Telegram e o sandbox do agente. Não é o seu site. |
| **Sandbox** | Sandbox | O Cloudflare Container onde o agente trabalha numa cópia do repositório e roda a homologação. Ele dorme quando está ocioso. |
| **Agente** | Agent | A IA que muda o seu código a partir de uma conversa. |
| **Pedido** | Request | Uma coisa que um membro pediu ao agente. Os pedidos rodam um de cada vez. |
| **Homologação** | Preview | O site rodando a partir do branch `homolog`, com mudanças esperando uma decisão. |
| **`homolog`** | `homolog` | O branch em que o agente faz commit. |
| **Versão** | Version | Cada conjunto de mudanças que o agente enviou para a homologação (versão 1, 2…), e cada publicação em **Versões**. |
| **Aprovar e publicar** | Approve and publish | Fazer o merge da homologação no branch de produção, o que faz o deploy da produção. |
| **Descartar** | Discard | Voltar a homologação para a produção, descartando as mudanças dela. |
| **Publicação** | Release | Uma aprovação ou um rollback mergeado, com deploy feito pelo GitHub Actions. |
| **Reverter** | Rollback | Uma publicação que reverte a anterior. |
| **Branch de produção** | Production branch | O branch de que a produção faz deploy, geralmente `main`. |
| **Dono** | Owner | Gerencia as configurações, as chaves e os acessos de um projeto. Numa organização, os admins dela. |
| **Membro** | Member | Pede mudanças e aprova publicações. |
| **Organização** | Organization | Uma organização do GitHub com o app da bohr instalado; os membros dela espelham os do GitHub. |
| **Provedor do modelo** | Model provider | De onde vem o modelo do agente: Anthropic, um endpoint compatível ou uma assinatura Claude. |
| **Variáveis do site** | Site variables | Valores que o Worker de produção lê em tempo de execução. |
| **Variáveis do build** | Build variables | Valores que o build do GitHub Actions lê, guardados criptografados na bohr. |
| **Hospedado pela bohr** | Hosted by bohr | Um projeto migrado da bohr v1, ainda na conta da Cloudflare da bohr (`mode: managed`). |
| **Sua conta da Cloudflare** | Own account | Um projeto na conta da Cloudflare do dono (`mode: byo`). |
| **Plano de build** | Build plan | Como a bohr v2 faz o build de um projeto migrado que mantém o workflow da v1. |
| **Token** | Token | Uma credencial `bohr_…` para a CLI, scripts e agentes de IA. |
| **Workflow de deploy** | Deploy workflow | `.github/workflows/bohr-deploy.yml`, escrito pela bohr a partir do `.bohr/deploy.json`. |
| **Bot da plataforma** | Platform bot | O bot do Telegram da própria instância, para o onboarding e para vincular contas. Cada projeto tem o próprio **bot do projeto**. |
