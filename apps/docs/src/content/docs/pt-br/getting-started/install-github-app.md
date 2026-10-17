---
title: Instalar o app do GitHub
description: Dê à bohr acesso aos repositórios que ela pode usar, pelo app do GitHub dela.
sidebar:
  order: 3
---

A bohr lê e muda os seus repositórios pelo **app do GitHub** dela, apenas nos repositórios que você selecionar.

1. No passo **GitHub**, clique em **Instalar no GitHub**. A instalação abre em uma nova aba.
2. Escolha a sua conta (ou uma organização de que você é dono) e escolha **Only select repositories** ou **All repositories**.
3. Confirme, volte ao painel e clique em **Já instalei**.

## O que o app pode fazer

O GitHub mostra estas permissões antes de você confirmar:

| Permissão | Por quê |
| --- | --- |
| Contents: write | O agente faz push para o branch `homolog`; as aprovações fazem merge na produção |
| Pull requests: write | As aprovações abrem pull requests e fazem merge deles; as reversões abrem pull requests de revert |
| Workflows: write | A bohr escreve o workflow de deploy. O sandbox do agente nunca recebe esta permissão. |
| Secrets: write | Remove os secrets do Actions que versões antigas da bohr escreveram |
| Actions: read | A bohr avisa quando o deploy de produção termina e mostra os [Builds](/pt-br/projects/builds/) |
| Metadata: read | Lista os seus repositórios |
| Organization › Members: read | As [organizações](/pt-br/organizations/overview/) espelham os membros da organização do GitHub |
| Administration: write | Cria repositórios a partir de [modelos](/pt-br/getting-started/templates/), só com a sua autorização |

Os tokens que a bohr cria a partir do app são de curta duração e restritos a um repositório. O token que o sandbox do agente usa só pode escrever conteúdo.

## Dar acesso a mais repositórios

Ao criar um projeto, um repositório que não aparece na lista geralmente significa que o app não o enxerga. Clique em **Dê acesso a mais repositórios no GitHub**, adicione o repositório no GitHub e depois clique em **Atualizar a lista**.

Os repositórios que já são projetos da bohr não aparecem na lista.

## Remover o acesso

**Conta › Contas conectadas › App do GitHub** lista as contas em que o app está instalado. **Desconectar** desinstala o app daquela conta; os projetos que ainda o usam precisam ser excluídos antes. Os seus repositórios não são alterados.
