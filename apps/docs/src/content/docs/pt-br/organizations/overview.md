---
title: Organizações
description: Trabalhe em equipe numa organização da bohr, que espelha uma organização do GitHub.
sidebar:
  order: 1
---

Uma **organização** da bohr é uma organização do GitHub com o app do GitHub da bohr instalado. Os membros vêm do GitHub, e ela tem a própria assinatura (no bohr.io Cloud), conta da Cloudflare e configurações do agente, separadas das de cada pessoa.

## Criar uma organização

Você precisa de uma organização no GitHub da qual seja **dono**. A bohr não cria organizações no GitHub: se precisar, crie uma no GitHub antes (**Criar uma organização no GitHub**).

1. Abra o menu de contexto no topo do painel e escolha **Nova organização**.
2. Clique em **Instalar o app do GitHub numa organização**.
3. No GitHub, escolha a organização e os repositórios que a bohr pode acessar, e confirme.
4. O GitHub traz você de volta para a página da organização na bohr.

A bohr importa os membros da organização com o papel equivalente: os donos no GitHub viram **admins**, e os demais, **membros**. Se o App foi instalado fora da bohr por alguém que já usa a bohr, a organização também é criada.

## Configurar

A página da organização mostra **Configure a organização** para os admins, com três passos (como na sua própria conta):

| Passo | |
| --- | --- |
| **Assinatura** | Só no bohr.io Cloud: a assinatura própria da organização, paga por um admin. Os membros não precisam de uma. |
| **Cloudflare** | A conta da Cloudflare onde rodam todos os projetos da organização. O mesmo token e os mesmos planos que [para você](/pt-br/getting-started/connect-cloudflare/): o plano gratuito serve, e numa instância auto-hospedada o agente precisa do Workers Paid. |
| **Agente** | O provedor e a chave que o agente usa em todos os projetos da organização. As mesmas opções que [as suas](/pt-br/agent/providers/), incluindo uma assinatura Claude. |

Até a configuração terminar, os membros veem *"Um admin da organização ainda precisa terminar a configuração (assinatura e conta da Cloudflare) antes de criar projetos."*

## Alternar entre pessoal e organização

O menu de contexto no topo do painel (**Trabalhar em**) lista **Pessoal** e cada uma das suas organizações. A lista de projetos, **Novo projeto** e as configurações seguem o contexto escolhido.

- Projetos criados numa organização usam a conta da Cloudflare e o agente da organização, seja quem for que os crie.
- No seu contexto pessoal, uma lista lembra das organizações cujos projetos não precisam de configuração na sua conta.

## Páginas da organização

| Página | |
| --- | --- |
| **Projetos** | Os projetos da organização, e **Novo projeto** (um dos repositórios da organização) |
| **Membros** | Membros, papéis e sincronização com o GitHub. Veja [Membros e papéis](/pt-br/organizations/members/). |
| **Configurações** | Geral, Cloudflare, agente, assinatura e a zona de perigo. Veja [Configurações e cobrança](/pt-br/organizations/settings-and-billing/). |
