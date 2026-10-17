---
title: Administração
description: Os administradores da instância, a área de Administração do painel e a API de administração.
sidebar:
  order: 6
---

## Administradores

A **primeira pessoa que entra** numa instância nova vira a administradora dela. Os administradores:

- veem a área **Administração** no painel;
- têm acesso de dono a todos os projetos e organizações (o projeto mostra *"Você está vendo este projeto como administrador"*), e as mudanças deles ficam registradas como de administrador no log de auditoria;
- atualizam os runtimes dos projetos e escolhem se a instância envia [telemetria](/pt-br/self-hosting/telemetry/).

Os tokens da CLI nunca carregam o papel de administrador.

## A área de Administração

| Página | |
| --- | --- |
| **Visão geral** | Usuários, projetos e assinaturas ativas, e **Runtimes**: **Atualizar runtimes** leva o Worker de cada projeto à versão desta instância |
| **Usuários** | Busca por nome, e-mail ou login. A página de um usuário lista os projetos e as organizações dele, **Tornar admin** / **Remover admin** e a exclusão da conta |
| **Projetos** | Busca por nome, repositório ou dono; status, hospedagem e runtime de cada um |
| **Organizações** | Busca por nome ou login no GitHub; membros, projetos e assinatura |
| **Telemetria** | A chave de opt-in e exatamente o que seria enviado |

A instância precisa de pelo menos um administrador: *"A instância precisa de pelo menos um admin."*

## A API de administração

Chamadas com `Authorization: Bearer <ADMIN_TOKEN>`:

```sh
# Torna alguém administrador (ou "user" para remover); identifique a pessoa por email, githubLogin ou userId
curl -X POST https://<your instance>/api/admin/users/role \
  -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","role":"admin"}'

# Leva o runtime de todos os projetos à versão desta instância
curl -X POST https://<your instance>/api/admin/runtimes/update -H "Authorization: Bearer <ADMIN_TOKEN>"

# Aponta o bot da plataforma para a instância (depois de definir o TELEGRAM_BOT_TOKEN)
curl -X POST https://<your instance>/api/admin/platform-bot -H "Authorization: Bearer <ADMIN_TOKEN>"

# Recriptografa todas as credenciais guardadas com a chave mestra atual (depois de uma rotação de chave)
curl -X POST https://<your instance>/api/admin/vault/rewrap -H "Authorization: Bearer <ADMIN_TOKEN>"
```

Mantenha o `ADMIN_TOKEN` em segredo: ele abre o `/setup` e estas chamadas.
