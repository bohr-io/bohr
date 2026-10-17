---
title: Domínios próprios
description: Ligue domínios da sua conta da Cloudflare ao site de produção.
sidebar:
  order: 7
---

**Configurações › Domínios** liga domínios ao seu site de produção como **Custom Domains** da Cloudflare no Worker dele. A Cloudflare cria o registro DNS e o certificado automaticamente.

## Antes de começar

- O site precisa ter sido **publicado uma vez**: os domínios se ligam ao Worker do site, que nasce no primeiro deploy. Até lá, a página mostra *"O site ainda não foi publicado"*.
- O domínio precisa ser uma **zona na mesma conta da Cloudflare** em que o projeto roda. Se o domínio estiver em outro lugar, adicione-o à Cloudflare antes (e aponte os nameservers dele para a Cloudflare). Se a conta não tiver zonas, a página mostra *"Sua conta da Cloudflare ainda não tem domínios."*

## Adicionar um domínio

1. Em **Adicionar domínio**, escolha a zona em **Domínio na Cloudflare**.
2. Opcional: digite um **Subdomínio** (`www`, `loja`…). Deixe vazio para usar a própria zona.
3. Confira *O site vai abrir em …* e clique em **Adicionar**.

O certificado pode levar alguns minutos. A página também mostra o **Worker** do site e o **Endereço workers.dev** dele, que continua funcionando.

Curingas (`*.example.com`) não são aceitos.

## Remover um domínio

Clique em **Remover** ao lado dele e confirme. O site deixa de abrir nesse domínio; o registro DNS sai junto.

## Projetos hospedados pela bohr

Projetos migrados da bohr v1 mantêm os domínios que tinham na v1, servidos pela bohr (cada um mostra **No ar** ou **Pendente**). Para mudá-los, [mova o projeto para a sua conta da Cloudflare](/pt-br/migrating-from-v1/move-to-your-cloudflare/).
