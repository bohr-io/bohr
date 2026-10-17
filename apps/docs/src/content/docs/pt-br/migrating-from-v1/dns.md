---
title: DNS de domínios hospedados pela bohr
description: Gerencie os registros DNS de um domínio cuja zona a bohr v1 manteve na conta da Cloudflare da bohr, ou leve-o para a sua.
sidebar:
  order: 4
---

Na bohr v1, um domínio podia ter todo o DNS hospedado pela bohr: a zona dele fica na conta da Cloudflare da bohr, com os seus registros de e-mail (MX, DKIM, SPF), os seus próprios servidores e os registros que a bohr usa para servir os seus sites. Na bohr v2 você continua gerenciando esses registros no painel, em **Domínios** no menu principal.

## Quem vê

**Domínios** só aparece quando você tem pelo menos um domínio assim.

- Um domínio seu (era seu na v1): você vê e muda os registros.
- Um domínio de uma organização: os **admins** dela mudam os registros; os **membros** só veem.

Cada mudança fica no log de auditoria da bohr, com o registro antes e depois.

## Mudar os registros

Abra o domínio. A tabela lista todos os registros com tipo, nome, conteúdo, TTL, proxy e prioridade.

- **Adicionar registro**: escolha o tipo (A, AAAA, CNAME, MX, TXT, SRV ou CAA), o nome (`@` para o próprio domínio, ou um subdomínio como `www`) e o conteúdo. Registros MX e SRV precisam de prioridade. Só registros A, AAAA e CNAME podem passar pelo proxy da Cloudflare; registros com proxy sempre têm TTL automático.
- **Editar** e **Excluir**, ao lado de um registro, mudam o registro na Cloudflare na hora.

Se algo estiver errado num registro, o diálogo diz o quê. Quando a própria Cloudflare recusa um registro (por exemplo, já existe um igual), o motivo dela aparece.

| Tipo | Conteúdo |
| --- | --- |
| A / AAAA | Um endereço IPv4 ou IPv6, como `203.0.113.10` |
| CNAME | Um nome de host, como `app.example.net` |
| MX | O servidor de e-mail, como `mx.zoho.com`, com prioridade |
| TXT | O texto, como `v=spf1 include:zoho.com ~all` |
| SRV | `peso porta destino`, como `5 5060 sip.example.com`, com prioridade; o nome começa com o serviço e o protocolo (`_sip._tcp`) |
| CAA | `flags tag valor`, como `0 issue "letsencrypt.org"` |

## O que fica travado, e por quê

Registros marcados com **Usado pela bohr** não podem ser mudados nem excluídos no painel:

- Os **registros A, AAAA e CNAME dos nomes que a bohr serve** (o domínio e os subdomínios dos seus sites hospedados pela bohr). Muitos apontam para um endereço fictício como `255.255.255.255`: a Cloudflare leva esses nomes até a bohr, que serve o site; o endereço em si nunca é acessado.
- O **registro curinga** (`*.example.com`) quando um site seu responde por ele.
- Os **registros NS** do domínio: são os nameservers da Cloudflare.

Pelo mesmo motivo, você não pode adicionar um registro A, AAAA ou CNAME a um nome que a bohr serve (um segundo endereço dividiria o tráfego dele), nem qualquer registro a um nome que responde pelo curinga (um registro próprio faria o curinga deixar de responder por ele).

O resto é seu: e-mail (MX, DKIM, SPF, DMARC), verificações (TXT), registros que apontam para os seus próprios servidores e novos subdomínios.

## Levar o domínio para a sua própria conta da Cloudflare

Você pode levar o domínio para uma conta da Cloudflare sua (o plano gratuito basta) quando quiser:

1. Na página do domínio na bohr, clique em **Exportar os registros (arquivo BIND)**.
2. Se o domínio serve sites hospedados pela bohr, primeiro [mova esses projetos para a sua conta da Cloudflare](/pt-br/migrating-from-v1/move-to-your-cloudflare/), ou planeje para onde os nomes deles vão apontar: depois que os nameservers mudam, a bohr deixa de responder pelo domínio.
3. No painel da Cloudflare, adicione o domínio (**Add a domain**) e vá em **DNS › Records › Import and Export** para importar o arquivo. Revise os registros: remova os fictícios (`255.255.255.255`), que só faziam sentido na conta da bohr.
4. No seu registrador (por exemplo, o Registro.br para domínios `.br`), troque os nameservers pelos dois que a Cloudflare mostra para o domínio na sua conta.
5. Espere a Cloudflare mostrar o domínio como **Active** (em geral minutos, até 24 horas). Depois avise a gente em [contact@bohr.io](mailto:contact@bohr.io) e removemos a cópia da conta da bohr.
