---
title: A página do projeto
description: A lista de projetos, o menu do projeto e a visão geral.
sidebar:
  order: 1
---

## A lista de projetos

**Projetos** mostra os seus projetos (ou os da organização atual). Cada cartão mostra o repositório, os endereços de produção e de homologação, o bot do Telegram, se houver, e uma situação:

| Situação | Significado |
| --- | --- |
| **Agente pronto** | O Worker do projeto está rodando e o agente pode trabalhar |
| **Configurando** | A bohr está criando o Worker, o sandbox e a homologação do projeto |
| **Falha na configuração** | Abra o projeto para ver o motivo e tente de novo |
| **Só deploys** | Sem agente: o projeto publica o que chega ao GitHub |
| **Migrando** | Um projeto da bohr v1 sendo transferido |
| **Suspenso** | O projeto não faz deploy; fale com o administrador da instância |

Projetos em que você é membro, mas não dono, mostram o selo **Membro**.

## O menu do projeto

| Página | Para que serve |
| --- | --- |
| **Visão geral** | Endereços, a atividade do agente, a homologação, a última versão e o que falta |
| **Agente** | O [chat](/pt-br/agent/chat/) com o agente |
| **Versões** | [Publicações e reversão](/pt-br/agent/versions-and-rollback/) |
| **Builds** | As [execuções do GitHub Actions](/pt-br/projects/builds/) com os logs |
| **Membros** | [Quem participa do projeto](/pt-br/projects/members/) e os convites |
| **Configurações** | [Geral, Domínios, Variáveis de ambiente, Autenticação, Agente, Hospedagem](/pt-br/projects/settings/) |

O cabeçalho tem links para o site em produção, a homologação e o repositório no GitHub.

## Visão geral

- **Endereços**: **Produção** e **Homologação**. A homologação fica *Disponível quando o agente estiver ligado*.
- **Agente**: *Trabalhando em:* o pedido atual, ou *Nenhum pedido em andamento.*, o número de pedidos na fila e **Abrir o agente**.
- A situação da homologação: *A homologação está igual à produção.* ou o que mudou, com **Aprovar e publicar** e **Descartar**, e **Ver a homologação**.
- **Última versão**: a última publicação e **Ver as versões**.
- **O que falta**: uma lista do que ainda depende de você, por exemplo *O agente não está configurado*, *Repositório não preparado* (com **Preparar repositório**), *Nenhum build ainda* ou *A configuração do projeto falhou*.

### A visualização do site

Clique no site na Visão geral para abri-lo em tela cheia. A barra mostra a **Versão mostrada** (**No ar**, branch, **Última atualização**, **Hash**, **Ver logs**), deixa você girar o dispositivo e **Abrir em nova aba**, e **Chat** abre o agente ao lado do site, mudando a visualização para a homologação. Ao lado do seletor, a homologação aparece *Igual à produção* ou com alterações (*Com 2 alterações*; passe o mouse para ver o que mudou).

## Quem pode fazer o quê

| | Dono | Membro |
| --- | --- | --- |
| Pedir mudanças, aprovar, descartar, reverter | Sim | Sim |
| Cancelar pedidos | De qualquer pessoa | Os próprios |
| Convidar e remover membros | Sim | Não |
| Configurações (variáveis, domínios, autenticação, agente) | Sim | Só leitura |
| Excluir o projeto | Sim | Não |

Numa [organização](/pt-br/organizations/overview/), os admins da organização são donos de todos os projetos; os membros dela são membros.
