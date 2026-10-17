---
title: Como funciona
description: De um repositório do GitHub até a produção, passando pelo agente, pela homologação e por uma aprovação.
sidebar:
  order: 1
---

A bohr conecta três coisas que você já tem: um **repositório do GitHub** (o código), uma **conta da Cloudflare** (onde o site roda) e um **provedor de modelo** (o cérebro do agente de IA, como uma chave da API da Anthropic ou a sua assinatura Claude).

```
Você (chat web ou Telegram)
   │  "Adicione um formulário de contato na página inicial"
   ▼
Worker do projeto na sua conta da Cloudflare
   ├─ fila de pedidos, membros, histórico do chat
   ├─ sandbox do agente (um Cloudflare Container): edita o código, roda o build
   └─ homologação: o site, rodando a partir do branch "homolog"
   │
   ▼  Aprovar
Pull request homolog → branch de produção, com merge
   │
   ▼
O GitHub Actions faz o build e o deploy da produção na sua conta da Cloudflare
```

## O ciclo

1. **Conecte.** Você entra, conecta a sua conta da Cloudflare e instala o app do GitHub da bohr nos repositórios que a bohr pode usar. Isso é feito uma única vez.
2. **Crie um projeto.** Escolha um dos seus repositórios, ou comece a partir de um [modelo](/pt-br/getting-started/templates/). A bohr cria o Worker do projeto, o sandbox do agente e a homologação na sua conta da Cloudflare (de um a três minutos).
3. **O agente prepara o repositório.** Na primeira execução, o agente descobre como o seu projeto roda na Cloudflare: escreve o `.bohr/preview.json` (como rodar a homologação) e o `.bohr/deploy.json` (como fazer o build e o deploy da produção), adiciona uma configuração do wrangler se faltar e faz o build de produção passar.
4. **Peça uma mudança.** Escreva o que você quer em palavras simples, no chat do painel ou para o bot do Telegram do projeto. O agente edita o código no sandbox dele e faz push do resultado para o branch `homolog`.
5. **Revise a homologação.** A homologação mostra o site com a mudança, em um endereço próprio. Peça ajustes quantas vezes quiser; os pedidos seguintes continuam a mesma conversa.
6. **Aprove ou descarte.** **Aprovar e publicar** abre um pull request de `homolog` para o branch de produção e faz o merge. Em seguida, o GitHub Actions faz o build e o deploy da produção. **Descartar** joga as mudanças fora, e a homologação volta a ser igual à produção.
7. **Reverta** quando quiser: a bohr faz o merge de um revert da última publicação, e a produção volta para a versão anterior.

## O que roda onde

| Parte | Onde roda |
| --- | --- |
| A instância da bohr (painel, API, cofre de credenciais) | bohr.io Cloud, ou a sua própria conta da Cloudflare se você [hospedar a sua](/pt-br/self-hosting/overview/) |
| O Worker de cada projeto, o sandbox do agente e a homologação | A conta da Cloudflare do dono do projeto |
| O site de produção | A conta da Cloudflare do dono do projeto, como um Worker com static assets |
| O código, os branches, os pull requests e as execuções de deploy | O repositório do projeto no GitHub e o GitHub Actions |
| O modelo de IA | O seu provedor: Anthropic, um endpoint compatível com a Anthropic, ou a sua assinatura Claude |

Os projetos migrados da bohr v1 são a exceção: a bohr os hospeda na própria conta da Cloudflare até que os donos [os movam](/pt-br/migrating-from-v1/move-to-your-cloudflare/).

## Segurança desde o projeto

- **Nada chega à produção sem aprovação.** O agente só consegue fazer push para `homolog`. A produção só muda por um pull request aprovado e mesclado, e o merge aponta o commit exato que você revisou.
- **O sandbox nunca guarda as suas chaves.** O agente vê apenas marcadores; a bohr acrescenta a chave real do modelo e um token do GitHub de curta duração, restrito a um repositório, na saída. Veja [Modelo de segurança](/pt-br/reference/security/).
- **O agente não consegue mudar os seus workflows.** O GitHub recusa qualquer mudança em `.github/workflows` vinda do sandbox; a própria bohr escreve o workflow de deploy dela.
