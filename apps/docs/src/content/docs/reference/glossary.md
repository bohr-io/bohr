---
title: Glossary
description: The words bohr uses, in English and in the Portuguese panel.
sidebar:
  order: 1
---

| Term | Portuguese panel | Meaning |
| --- | --- | --- |
| **Instance** | Instância | The bohr control plane: the panel, the API and the credential vault. bohr.io Cloud is one; you can [host your own](/self-hosting/overview/). |
| **Project** | Projeto | One GitHub repository, its production site and its agent. |
| **Project Worker** | Worker do projeto | The Worker bohr creates in the owner's Cloudflare account for each project: the request queue, members, chat, the Telegram bot and the agent's sandbox. Not your site. |
| **Sandbox** | Sandbox | The Cloudflare Container where the agent works on a copy of the repository and runs the preview. It sleeps when idle. |
| **Agent** | Agente | The AI that changes your code from a conversation. |
| **Request** | Pedido | One thing a member asked the agent. Requests run one at a time. |
| **Preview** | Homologação | The site running from the `homolog` branch, with changes waiting for a decision. |
| **`homolog`** | — | The branch the agent commits to. |
| **Version** | Versão | Each set of changes the agent pushed to the preview (version 1, 2…), and each release in **Versions**. |
| **Approve and publish** | Aprovar e publicar | Merge the preview into the production branch, which deploys production. |
| **Discard** | Descartar | Reset the preview to production, dropping its changes. |
| **Release** | Publicação | A merged approval or rollback, deployed by GitHub Actions. |
| **Rollback** | Reverter | A release that reverts the last one. |
| **Production branch** | Branch de produção | The branch production deploys from, usually `main`. |
| **Owner** | Dono | Manages a project's settings, keys and access. In an organization, its admins. |
| **Member** | Membro | Asks for changes and approves releases. |
| **Organization** | Organização | A GitHub organization with bohr's app installed; its members mirror GitHub's. |
| **Model provider** | Provedor do modelo | Where the agent's model comes from: Anthropic, a compatible endpoint, or a Claude subscription. |
| **Site variables** | Variáveis do site | Values the production Worker reads at runtime. |
| **Build variables** | Variáveis do build | Values the GitHub Actions build reads, kept encrypted in bohr. |
| **Hosted by bohr** | Hospedado pela bohr | A project migrated from bohr v1, still in bohr's Cloudflare account (`mode: managed`). |
| **Own account** | Sua conta da Cloudflare | A project in its owner's Cloudflare account (`mode: byo`). |
| **Build plan** | — | How bohr v2 builds a migrated project that keeps its v1 workflow. |
| **Token** | Token | A `bohr_…` credential for the CLI, scripts and AI agents. |
| **Deploy workflow** | — | `.github/workflows/bohr-deploy.yml`, written by bohr from `.bohr/deploy.json`. |
| **Platform bot** | — | The instance's own Telegram bot, for onboarding and linking accounts. Each project has its own **project bot**. |
