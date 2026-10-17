---
title: .bohr/preview.json
description: Referência do arquivo que diz à bohr como rodar o servidor de desenvolvimento da homologação no sandbox do agente.
sidebar:
  order: 4
---

A [homologação](/pt-br/agent/previews/) é o **servidor de desenvolvimento** do seu projeto, rodando no sandbox do agente a partir do branch `homolog`. O `.bohr/preview.json` diz como iniciá-lo. O agente escreve o arquivo quando prepara o repositório e o mantém funcionando.

```json
{
  "install": "npm ci",
  "command": "npm run dev -- --host 0.0.0.0 --port 8080",
  "port": 8080,
  "env": {}
}
```

## Campos

| Campo | Obrigatório | Descrição |
| --- | --- | --- |
| `command` | Sim | O comando do servidor de desenvolvimento, que fica rodando (até 1000 caracteres). Roda com `bash -lc` na raiz do repositório. |
| `port` | Sim | A porta em que o servidor de desenvolvimento escuta, de 1024 a 65535. A porta `4840` é reservada para o agente da bohr. |
| `install` | Não | Instala as dependências. Roda no primeiro início e sempre que um manifesto de dependências ou lockfile muda. |
| `env` | Não | Variáveis de ambiente extras para `install` e `command`. Nunca secrets: este arquivo vai para o commit. |

Os comandos também recebem `PORT` (a porta), `HOST=0.0.0.0`, `BROWSER=none` e `CI=1`.

## Requisitos do servidor de desenvolvimento

- Escutar em `0.0.0.0` (todas as interfaces) na `port`. Servidores de desenvolvimento que só escutam em `localhost` também funcionam.
- Aceitar qualquer cabeçalho `Host`. O Vite, por exemplo, precisa de `server.allowedHosts: true`.
- Ficar pronto em até **3 minutos**. Senão, a homologação é marcada como falha, com o fim da saída.
- O `install` precisa terminar em até 15 minutos.

## Quando ela reinicia

- Depois de cada pedido e de cada sincronização, a homologação reinicia se o `.bohr/preview.json` ou as dependências mudaram (`package.json`, lockfiles, `requirements*.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml` e afins, em qualquer lugar do repositório), ou se ela não estiver rodando. Caso contrário, o próprio reload do servidor de desenvolvimento pega a mudança.
- Parar mata o grupo de processos inteiro: tudo o que o comando iniciou para junto.

## Estados

A homologação passa por estes estados:

| Estado | Significado |
| --- | --- |
| `starting` | Instalando ou esperando a porta |
| `running` | A porta aceita conexões |
| `failed` | O comando terminou, ou a porta não abriu a tempo; o log mostra o fim da saída |
| `stopped` | Ainda não há checkout, não há `.bohr/preview.json` ou ele é inválido |

Mensagens que você pode ver: *"A homologação ainda não está configurada: o agente prepara isso ao importar o repositório."* (ainda sem arquivo) e *"A homologação não conseguiu iniciar. Peça ao agente para verificar o arquivo .bohr/preview.json."*

## Exemplos

Um Worker com banco de dados D1 (os modelos):

```json
{
  "install": "npm ci",
  "command": "npx wrangler d1 migrations apply DB --local && npx wrangler dev --ip 0.0.0.0 --port 8080",
  "port": 8080
}
```

Astro:

```json
{ "install": "npm ci", "command": "npx astro dev --host 0.0.0.0 --port 4321", "port": 4321 }
```
