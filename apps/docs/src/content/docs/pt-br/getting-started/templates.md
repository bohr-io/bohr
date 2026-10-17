---
title: Começar por um modelo
description: Crie um projeto a partir de um dos sites prontos da bohr, com repositório e banco de dados D1 próprios.
sidebar:
  order: 5
---

Um modelo é um site pequeno e útil que você pode publicar na hora e depois mudar pedindo ao agente. A bohr cria um **repositório no GitHub** a partir do modelo, um **banco de dados D1** na sua conta da Cloudflare, e publica o site.

## Criar

1. Clique em **Novo projeto** e, em **Como começar**, escolha **Um modelo**.
2. Escolha um modelo.
3. Preencha:
   - **Nome do projeto**: também é o nome do repositório no GitHub (letras, números, `.`, `-` e `_`).
   - **Dono**: onde o repositório é criado no GitHub, **Minha conta pessoal** ou uma das suas organizações. O projeto roda na conta da Cloudflare desse dono.
   - **Repositório privado**: só quem tem acesso ao repositório vê o código. O site publicado fica aberto de qualquer forma.
4. Clique em **Criar o projeto**. O GitHub pede que você autorize a bohr a criar o repositório em seu nome.

O seu token da Cloudflare precisa da permissão **D1: Edit**. Sem ela, o painel diz *"O token da Cloudflare não pode criar bancos de dados D1."* e oferece o link **Editar o token na Cloudflare**.

## A senha de admin

Todo modelo tem uma área administrativa em `/admin`. A bohr gera a senha dela e a mostra **uma única vez**, em **Senha da área administrativa**: guarde-a nessa hora. Ela é a [variável do site](/pt-br/projects/variables/) `ADMIN_PASSWORD`, onde você pode trocá-la depois.

O site fica no ar assim que o primeiro deploy termina (alguns minutos).

## Os modelos

Todo modelo é um Cloudflare Worker (API em [Hono](https://hono.dev) mais arquivos estáticos) com um banco de dados D1. As páginas falam português do Brasil, inglês e espanhol, conforme o navegador do visitante.

| Modelo | O que você ganha |
| --- | --- |
| **Lista de espera** | Uma página de lançamento que coleta nomes e e-mails de interessados, sem duplicados, com um admin para ver, buscar e exportar as inscrições em CSV. Cada visitante vê a posição dele na fila. |
| **Agendamentos** | Uma página de agendamento online em que os clientes escolhem um serviço, um dia e um horário livre, com um admin para confirmar os agendamentos e gerenciar serviços e horários de funcionamento. Os agendamentos nunca se sobrepõem. |
| **Link na bio** | Uma página com a sua foto, a sua bio e todos os seus links, com contagem de cliques por link e um admin para editar, esconder e reordenar os links. |
| **Formulários e pesquisas** | Monte formulários com perguntas de texto, e-mail, múltipla escolha e avaliação por estrelas, compartilhe o link e veja as respostas em gráficos ou exporte em CSV. |
| **Cardápio digital** | Um cardápio online com carrinho, em que os clientes montam o pedido e enviam pelo WhatsApp, com um admin para gerenciar pedidos, itens e preços. |
| **Links curtos** | Um encurtador de URLs no seu próprio domínio, com links personalizados, cliques por dia e um admin para criar, editar e desligar links. |

O código dos modelos é público nos repositórios `bohr-io/template-<name>` no GitHub (por exemplo `bohr-io/template-waitlist`).

## Como um projeto de modelo é configurado

- O `wrangler.jsonc` recebe o nome do Worker (o nome do projeto) e o novo banco de dados.
- O `.bohr/deploy.json` e o `.bohr/preview.json` dizem à bohr como fazer o deploy e a homologação.
- As mudanças no schema do banco de dados são novos arquivos em `migrations/`; cada deploy de produção os aplica primeiro (veja [Bancos de dados D1](/pt-br/deploys/d1-databases/)).

A partir daí, é um projeto como qualquer outro: peça mudanças ao agente. O README de cada modelo lista ideias, como *"Envie um e-mail de boas-vindas para cada nova inscrição"* na lista de espera.

Se algo falhar depois que o GitHub criou o repositório, a bohr desfaz o que criou (banco de dados, projeto), exceto o repositório, e a mensagem de erro informa o nome dele.
