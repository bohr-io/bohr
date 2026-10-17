---
title: Telemetry
description: The anonymous, opt-in telemetry of self-hosted instances, what it sends and how to keep it off.
sidebar:
  order: 8
---

Self-hosted instances can send anonymous usage telemetry. It is **off by default**: an instance administrator turns it on in **Admin › Telemetry**, which shows exactly what is sent.

## What is sent

```json
{
  "instanceId": "3f1c2a9e-8b7d-4c1e-9a2f-6d5e4b3a2c1d",
  "version": "2.0.0",
  "projects": 12
}
```

- `instanceId`: a random ID created for this purpose; it identifies nothing but the instance.
- `version`: the instance's version.
- `projects`: how many projects it has.

Nothing else: no names, emails, URLs, repositories or IP-derived data are stored.

## When and where

Once a day, from the instance's hourly cron, as a `POST` to `https://app.bohr.io/api/telemetry`. The first ping goes out right away when you turn it on, so **Last sent** shows it worked.

## Why

To know how many instances and versions are out there, so bohr knows what to keep compatible.

## Turning it off

- Switch **Send anonymous telemetry** off in **Admin › Telemetry**, or
- set the variable `BOHR_TELEMETRY=off` in `wrangler.jsonc` and deploy. It keeps telemetry off whatever the panel says; the panel then shows *"Telemetry is turned off in this instance's configuration (BOHR_TELEMETRY=off)"*.

bohr.io Cloud never sends telemetry; it only receives these pings.
