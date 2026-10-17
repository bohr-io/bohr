---
title: Telemetria
description: A telemetria anônima e opcional das instâncias auto-hospedadas, o que ela envia e como mantê-la desligada.
sidebar:
  order: 8
---

As instâncias auto-hospedadas podem enviar telemetria anônima de uso. Ela vem **desligada por padrão**: um administrador da instância a liga em **Administração › Telemetria**, que mostra exatamente o que é enviado.

## O que é enviado

```json
{
  "instanceId": "3f1c2a9e-8b7d-4c1e-9a2f-6d5e4b3a2c1d",
  "version": "2.0.0",
  "projects": 12
}
```

- `instanceId`: um ID aleatório criado para isso; ele não identifica nada além da instância.
- `version`: a versão da instância.
- `projects`: quantos projetos ela tem.

Nada mais: nenhum nome, e-mail, URL, repositório ou dado derivado de IP é guardado.

## Quando e para onde

Uma vez por dia, a partir do cron de hora em hora da instância, como um `POST` para `https://app.bohr.io/api/telemetry`. O primeiro ping sai assim que você liga, então **Último envio** mostra que funcionou.

## Por quê

Para saber quantas instâncias e versões existem por aí, e assim a bohr saber com o que precisa manter compatibilidade.

## Desligar

- Desligue **Enviar telemetria anônima** em **Administração › Telemetria**, ou
- defina a variável `BOHR_TELEMETRY=off` no `wrangler.jsonc` e faça o deploy. Ela mantém a telemetria desligada, diga o painel o que disser; o painel então mostra *"A telemetria está desligada na configuração desta instância (BOHR_TELEMETRY=off)"*.

O bohr.io Cloud nunca envia telemetria; ele só recebe esses pings.
