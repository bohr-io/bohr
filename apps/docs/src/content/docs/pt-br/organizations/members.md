---
title: Membros e papéis da organização
description: Como os membros da organização espelham o GitHub, os papéis deles e como mudar ou remover o acesso.
sidebar:
  order: 2
---

**O GitHub é a fonte dos membros.** A bohr espelha os membros da organização no GitHub: os donos no GitHub viram **admins** na bohr, e os demais, **membros**.

| Papel | Pode |
| --- | --- |
| **Admin** | Tudo o que o dono de um projeto pode, em todos os projetos da organização (configurações, domínios, variáveis, exclusão); as configurações, a assinatura, a conta da Cloudflare e o agente da organização; os papéis dos membros |
| **Membro** | Trabalhar em todos os projetos da organização: pedir mudanças, aprovar, descartar, reverter |

Os membros não precisam de assinatura, conta da Cloudflare nem chave de modelo próprias.

## Mantendo a sincronia

- Pessoas adicionadas à organização no GitHub ou removidas dela entram ou saem automaticamente (o GitHub avisa a bohr).
- **Sincronizar com o GitHub**, na página **Membros**, sincroniza manualmente: *"Membros sincronizados: N adicionados, N removidos, N atualizados."*
- Pessoas que ainda não têm conta na bohr aparecem como **Pendente** (*"Entra quando acessar a bohr com o GitHub."*). Elas ficam ativas quando entram com essa conta do GitHub, ou quando a vinculam à conta delas na bohr.

## Mudando o acesso na bohr

Os admins podem mudar coisas na bohr sem mexer no GitHub. Nesses casos, a coluna **Origem** mostra **Alterado na bohr**.

- **Tornar admin** / **Tornar membro**: o papel vale até o papel dessa pessoa mudar no GitHub.
- **Remover**: a pessoa perde o acesso aos projetos da organização na bohr. Ela continua na organização do GitHub, e a sincronização não traz o acesso de volta.
- A organização precisa de pelo menos um admin: *"A organização precisa de pelo menos um admin. Torne outra pessoa admin primeiro."*

## Quando os membros não são importados

Se o app do GitHub não tem a permissão **Members: read** na organização, só quem o instalou é adicionado, e a página diz *"Os membros não foram importados"*. Conceda a permissão no GitHub (as configurações do App na organização pedem que você a aceite) e depois clique em **Sincronizar com o GitHub**.

## Membros do projeto de fora da organização

Os [convites](/pt-br/projects/members/) de projeto também funcionam em projetos de organizações, para pessoas de fora da organização no GitHub, como um cliente que revisa a homologação.
