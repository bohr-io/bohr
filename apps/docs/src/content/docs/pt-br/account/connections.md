---
title: Sua conta e conexões
description: Perfil, idioma, formas de entrar e como desconectar o GitHub, o Telegram, a Cloudflare e o agente.
sidebar:
  order: 1
---

**Conta** (barra lateral) reúne o seu perfil e tudo o que está conectado à sua conta da bohr.

## Perfil e idioma

- **Perfil**: o seu **Nome** e **E-mail**.
- **Idioma**: o **Idioma da interface** (Português, English, Español). A escolha fica salva naquele navegador.
- **Sair da conta** encerra a sessão neste navegador.

## Contas conectadas

### Formas de entrar

Como você entra na bohr: **GitHub**, **E-mail** e **Telegram**. Sua conta precisa de pelo menos uma.

- **Conectar login do GitHub** vincula uma conta do GitHub.
- **Adicionar e-mail**: digite o endereço, clique em **Enviar código**, digite o código de 6 dígitos e clique em **Adicionar e-mail**. *"Este e-mail já pertence a outra conta da bohr."* quer dizer que ele já está em uso.
- **Vincular o Telegram** (quando a instância tem um bot da plataforma): abre o bot; toque em **Iniciar**. A partir daí, os bots dos projetos reconhecem você.
- **Remover** tira uma forma de entrar. A última não pode ser removida: *"Esta é a única forma de entrar na sua conta. Adicione outra antes de removê-la."*

### App do GitHub

As contas do GitHub em que o app da bohr está instalado, com quantos projetos usam cada uma. **Desconectar** desinstala o app daquela conta, e a bohr deixa de acessar os repositórios dela. Os projetos que ainda usam a conta precisam ser excluídos antes; os repositórios não são alterados.

### Cloudflare

As contas da Cloudflare em que os seus projetos são publicados. **Desconectar** apaga o token de API que a bohr guardava para aquela conta; os sites publicados nela continuam no ar. Os projetos que ainda usam a conta precisam ser excluídos antes. Apague também o próprio token no painel da Cloudflare (**My Profile → API Tokens**).

### Telegram

**Desconectar** faz o bot da bohr deixar de reconhecer você. Os bots dos projetos continuam no Telegram.

### Agente

O seu **Provedor** do modelo, o **Modelo** (ou *Padrão da bohr*) e o fim da sua **Chave**. **Configurar** abre [Provedores de modelo](/pt-br/agent/providers/). **Desconectar** apaga a chave do provedor e desliga o agente em todos os seus projetos; eles continuam publicando o que chega ao GitHub.

## Também nesta página

- **Assinatura**: se a sua assinatura do bohr.io Cloud está ativa, e **Ver a assinatura**. Veja [Assinatura](/pt-br/billing/subscription/).
- **Agente**: **Configurar o agente**.
- **Tokens e a CLI**: **Gerenciar tokens**. Veja [Tokens](/pt-br/account/tokens/).
- **Zona de perigo**: [excluir a sua conta](/pt-br/account/delete-account/).
