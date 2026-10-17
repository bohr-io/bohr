---
title: Provedores de modelo
description: Dê vida ao agente com uma chave da API da Anthropic, um endpoint compatível com a Anthropic ou a sua assinatura Claude Pro/Max.
sidebar:
  order: 5
---

O agente precisa de um modelo. Você o escolhe uma vez em **Conta › Agente** (**Configurar o agente**), e ele vale para todos os projetos de que você é dono. Uma [organização](/pt-br/organizations/settings-and-billing/) escolhe o dela para os projetos dela.

A chave fica guardada criptografada e chega ao Worker de cada projeto como um secret. O sandbox do agente nunca a vê: ele guarda um marcador, e a bohr acrescenta a chave real na saída.

## Chave da API da Anthropic (recomendado)

1. Crie uma chave no [Anthropic Console](https://console.anthropic.com). Ela começa com `sk-ant-`.
2. Em **Provedor**, escolha **Chave da API da Anthropic** e cole a chave em **Chave da API da Anthropic**.
3. **Modelo**: deixe em branco para usar o padrão da bohr, `claude-opus-5-5`, ou digite o id de outro modelo Claude.
4. **Esforço**: o quanto o modelo pensa antes de agir. **Padrão do modelo**, **Baixo**, **Médio**, **Alto**, **Muito alto** ou **Máximo**. Mais esforço significa um trabalho mais cuidadoso e mais tokens.
5. Clique em **Salvar**. A bohr confere a chave com a Anthropic antes de salvar.

## Provedor compatível

Qualquer API compatível com a Messages API da Anthropic: OpenRouter, DeepSeek, Kimi, GLM, um proxy LiteLLM na frente de outros provedores…

| Campo | Valor |
| --- | --- |
| **URL base** | O endereço da API antes de `/v1/messages`, com `https`. Por exemplo `https://openrouter.ai/api` ou `https://api.deepseek.com/anthropic`. |
| **Chave da API do provedor** | A chave que o seu provedor deu. A bohr confere se o provedor a aceita. |
| **Modelo** | Obrigatório: o nome do modelo no provedor, como `deepseek-chat` ou `moonshotai/kimi-k2`. |
| **Esforço** | Opcional. Provedores compatíveis podem ignorá-lo. |

O quanto o agente funciona bem depende do modelo: ele edita arquivos, roda comandos e segue instruções longas.

## Assinatura Claude (Pro/Max)

Use o seu plano Claude Pro ou Max em vez de uma chave de API. O agente roda pelo Claude Code oficial, e o uso está sujeito aos termos e limites da sua assinatura.

1. Escolha **Assinatura Claude (Pro/Max)** e clique em **Conectar assinatura Claude**.
2. Clique em **Autorizar no claude.ai** e autorize com a sua conta Claude.
3. Copie o código que o claude.ai mostra, cole em **Código de autorização** e clique em **Concluir conexão**.

Por trás, a bohr roda o `claude setup-token` da CLI oficial em um container isolado e guarda o token de longa duração que ele cria (começa com `sk-ant-oat01-`).

**Já tenho um token**: em um terminal com o Claude Code instalado, rode:

```sh
claude setup-token
```

entre com a sua conta e cole o token que ele mostra em **Token do Claude Code**.

:::note
Em algumas instâncias auto-hospedadas, a conexão roda no container de um dos seus projetos. Se nenhum estiver pronto ainda, o painel avisa: crie um projeto primeiro, ou cole um token do `claude setup-token`.
:::

Com uma assinatura, nada é cobrado por pedido. O [orçamento por pedido](/pt-br/agent/costs-and-limits/) continua valendo, como um limite de segurança estimado a preços da API.

## Mudar ou remover

- Salvar aplica as novas configurações a todos os projetos prontos de uma vez (*Salvo e aplicado a N projetos.*). Os projetos que estavam esperando um agente começam a [preparar o repositório](/pt-br/getting-started/first-deploy/).
- Para manter a chave guardada e mudar só o modelo ou o esforço, deixe o campo da chave em branco.
- **Remover** (*Desligar o agente?*) apaga a chave e desliga o agente em todos os seus projetos. Os deploys pelo GitHub continuam funcionando.
- Um projeto pode usar um **modelo** diferente do da sua conta: veja [Configurações do projeto](/pt-br/projects/settings/#agente).
