---
title: Modelo de segurança
description: O que a bohr pode acessar, como as credenciais são guardadas e por que o agente não consegue publicar nem vazar as suas chaves.
sidebar:
  order: 4
---

## O que a bohr pode acessar

| Acesso | Dado por | Usado para |
| --- | --- | --- |
| Os repositórios que você seleciona | O app do GitHub da bohr ([permissões](/pt-br/getting-started/install-github-app/#o-que-o-app-pode-fazer)) | O branch do agente, pull requests, merges, o workflow de deploy, os logs de build |
| A sua conta da Cloudflare | O token da API que você cria ([permissões](/pt-br/getting-started/connect-cloudflare/#criar-o-token)) | Criar e atualizar os Workers, o sandbox e a homologação de cada projeto; o seu deploy de produção; domínios, variáveis e proteção |
| O seu provedor de modelo | A sua chave da API ou o token da sua assinatura Claude | Os pedidos do agente |

## Como as credenciais são guardadas

| Credencial | Guardada | Observações |
| --- | --- | --- |
| Token da API da Cloudflare | No cofre da instância, com envelope encryption (AES-256-GCM) | Todo uso fica registrado no log de auditoria da instância. Entregue ao seu deploy de produção na hora da execução (e ao `bohr deploy` de um dono), nunca guardado no GitHub. |
| Chave privada do app do GitHub | No cofre da instância | Usada para tokens de instalação de curta duração, restritos a um repositório |
| Chave do modelo ou token Claude | Criptografados na instância, e como secret de cada Worker do projeto | O sandbox só tem um placeholder |
| Variáveis do build | Criptografadas na instância | Presas ao projeto, ao branch e ao nome delas |
| Variáveis do site | Secrets do seu Worker de produção | A bohr guarda os valores comuns só para mostrá-los |
| Senhas do site | Só hashes PBKDF2-SHA256 | — |
| Tokens da CLI e da API (`bohr_…`) | Só o hash SHA-256 deles | O token em si fica no seu computador ou em `BOHR_TOKEN` |
| Códigos de convite | Com hash | Uso único, 24 horas |

## O sandbox do agente

O sandbox é um Cloudflare Container na conta do dono do projeto. Ele **nunca guarda uma credencial**:

- O agente vê placeholders. Um gateway no Worker do projeto adiciona a chave real do modelo, só nos endpoints de mensagens do provedor e só enquanto um pedido roda, não enquanto a homologação roda entre pedidos.
- O tráfego do Git recebe um token de curta duração para aquele único repositório, com **contents: write** e nada mais. Os pushes só são aceitos enquanto um pedido roda, e só para o `homolog`.
- Sem a permissão de workflows, o GitHub recusa qualquer push que mude `.github/workflows`, então o código no sandbox não consegue adicionar um workflow que rodaria com os secrets do repositório.
- Requisições que carregam credenciais não seguem redirecionamentos, então um redirecionamento não consegue levar uma chave para outro lugar.
- Uma dependência maliciosa instalada no sandbox pode usar a rede, mas não consegue ler as chaves.

A única exceção: conectar uma assinatura Claude roda o `claude setup-token` num container, onde o novo token existe até o login terminar. Instâncias com o container de login dedicado o rodam ali, onde nenhum código de projeto roda.

## Aprovações

- A produção só muda por meio de um pull request aprovado e mergeado. O merge indica o commit revisado: mudanças enviadas depois de uma revisão não podem ser publicadas por aquela aprovação.
- O link do diff em cada decisão mostra exatamente o commit que a aprovação publica.
- A homologação é pública, mas não listada (um nome `workers.dev` impossível de adivinhar, `noindex`), e nunca chega à porta de controle do sandbox.

## Credenciais de deploy

Os projetos na sua própria conta fazem deploy pelo GitHub Actions com `wrangler deploy`, e **nenhum token da Cloudflare fica no repositório**. A primeira etapa da bohr no workflow pede um token OIDC do GitHub (audience `bohr.io`) e pede as credenciais à instância. A instância verifica o token (emissor, audience, validade, assinatura), encontra o projeto pelo id do repositório e só responde quando:

- a execução é do `.github/workflows/bohr-deploy.yml` no branch de produção, disparada por `push` ou `workflow_dispatch` (nada de pull request, outro branch ou outro workflow);
- o projeto roda na conta da Cloudflare do dono, com uma conexão do dono (a do usuário, ou a da organização).

Toda resposta é auditada (repositório, ref, id da execução; nunca o token). Toda recusa é um HTTP 403 com o motivo. O código que roda no workflow de produção só vem de merges aprovados ou de pessoas com permissão de escrita no branch de produção.

## Tokens

Um token `bohr_…` age como o usuário dele, só nos projetos que lista, e nunca com o papel de administrador da instância. Sessões de deploy abertas com um token só podem ser concluídas com o mesmo token.

Para o [`bohr deploy`](/pt-br/cli/deploy/#projetos-na-sua-própria-conta-da-cloudflare) de um projeto na conta Cloudflare do dono, um token também pode obter o token da API da Cloudflare e o id dessa conta, de que o wrangler precisa. A instância só responde quando:

- o token alcança o projeto e o usuário dele é dono do projeto (num projeto de organização: admin da organização);
- o projeto roda na conta da Cloudflare do dono, com uma conexão do dono. Nunca para projetos que a bohr hospeda, e nunca o token da conta da própria bohr.

Toda entrega fica registrada no log de auditoria (usuário, token, projeto), é respondida com `Cache-Control: no-store` e tem limite de 30 por usuário e projeto em 10 minutos (HTTP 429 acima disso). A CLI coloca o token da Cloudflare só no ambiente do wrangler: nunca numa linha de comando, num log ou em disco.

## O que a bohr deixa na sua conta da Cloudflare

Toda chamada à API envia `User-Agent: bohr/<version> (+https://bohr.io)`; os Workers da bohr levam as tags `bohr` e `bohr-project:<id>`; os deploys de produção, e as versões que o `bohr deploy` envia, levam a mensagem `bohr` e a tag `bohr-<commit>` (`bohr-local` para uma árvore de trabalho com mudanças não commitadas).

## Relatar uma vulnerabilidade

Mande um e-mail para [contact@bohr.io](mailto:contact@bohr.io). Por favor, não abra issues públicas para problemas de segurança. Respondemos em até 3 dias úteis.
