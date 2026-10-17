---
title: Perguntas frequentes sobre a migração
description: Dúvidas comuns dos clientes da bohr v1.
sidebar:
  order: 5
---

### Preciso fazer alguma coisa?

Não. O seu projeto foi movido para a bohr v2 por nós e continua fazendo deploy a partir do workflow do seu repositório. Movê-lo para a sua própria conta da Cloudflare e ativar o agente são opcionais.

### O meu preço mudou?

Não. Os clientes que pagavam pela bohr v1 mantêm o preço do plano. A página da assinatura mostra *Preço da versão anterior da bohr*.

### Os meus domínios ou o DNS mudaram?

Não. Os seus domínios próprios e endereços `bohr.io` continuam funcionando, sem mudanças de DNS. Se você [mover o projeto](/pt-br/migrating-from-v1/move-to-your-cloudflare/), cada domínio vai junto quando a zona dele estiver na sua conta da Cloudflare. Se a bohr v1 hospedava todo o DNS do seu domínio, você gerencia os registros em **Domínios**: veja [DNS de domínios hospedados pela bohr](/pt-br/migrating-from-v1/dns/).

### A bohr mudou o meu repositório?

Não. A migração não escreveu nada no seu repositório: nenhum workflow, nenhum arquivo, nenhum secret. A mudança para a sua própria conta, se você iniciá-la, abre um pull request que você revisa e faz o merge.

### O meu workflow ainda diz `bohr-io/action@main`. Está certo?

Sim. Essa action agora faz o build e o deploy do seu projeto na bohr v2. Deixe como está enquanto a bohr hospeda o projeto.

### Onde estão as minhas variáveis de ambiente?

Em **Configurações › Variáveis de ambiente**: variáveis do build para o build do GitHub Actions, e variáveis do site para o site em execução. Os valores secretos ficam ocultos.

### As homologações por branch ainda funcionam?

Sim, enquanto a bohr hospeda o projeto: cada branch que recebe push ganha `<branch>-<repo>-<owner>.bohr.io`. Depois da mudança para a sua conta, as homologações passam a vir do agente (o branch `homolog`).

### Posso usar KV, D1, R2 ou cron triggers?

Não enquanto a bohr hospeda o projeto: os projetos hospedados suportam static assets, `vars` e secrets. Mova o projeto para a sua conta da Cloudflare para usar qualquer binding da Cloudflare.

### O `npx bohr deploy` parou de funcionar no meu workflow da v1 ou no meu terminal.

A CLI da bohr v2 não faz deploy de projetos da bohr v1 nem aceita opções da v1. O seu workflow da v1 não precisa dela: ele faz deploy pelo `bohr-io/action`. Localmente, use o `bohr deploy` da bohr v2 ([documentação](/pt-br/cli/deploy/)).

### Um arquivo maior que 24 MiB sumiu do meu site.

A bohr v1 nunca publicou arquivos de 24 MiB ou mais, e os projetos migrados mantêm essa regra. O limite da própria Cloudflare é de 25 MiB por arquivo. Sirva arquivos grandes a partir de um armazenamento como o R2.

### Com quem eu falo?

[Discord](https://discord.com/invite/p3hhfGg2Uy) ou [contact@bohr.io](mailto:contact@bohr.io).
