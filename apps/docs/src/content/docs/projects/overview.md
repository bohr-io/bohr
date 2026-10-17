---
title: The project page
description: The project list, the project's menu and its overview.
sidebar:
  order: 1
---

## The project list

**Projects** shows your projects (or the current organization's). Each card shows the repository, the production and preview addresses, the Telegram bot if there is one, and a state:

| State | Meaning |
| --- | --- |
| **Agent ready** | The project's Worker is running and the agent can work |
| **Setting up** | bohr is creating the project's Worker, sandbox and preview |
| **Setup failed** | Open the project to see why and try again |
| **Deploys only** | No agent: the project publishes what reaches GitHub |
| **Migrating** | A project from bohr v1 being moved |
| **Suspended** | The project does not deploy; contact the instance's administrator |

Projects where you are a member but not the owner show a **Member** badge.

## The project menu

| Page | What it is for |
| --- | --- |
| **Overview** | Addresses, the agent's activity, the preview, the latest version, and what is missing |
| **Agent** | The [chat](/agent/chat/) with the agent |
| **Versions** | [Releases and rollback](/agent/versions-and-rollback/) |
| **Builds** | The [GitHub Actions runs](/projects/builds/) with their logs |
| **Members** | [Who is in the project](/projects/members/) and invites |
| **Settings** | [General, Domains, Environment variables, Authentication, Agent, Hosting](/projects/settings/) |

The header links to the production site, the preview and the repository on GitHub.

## Overview

- **Addresses**: **Production** and **Preview**. The preview is *Available once the agent is on*.
- **Agent**: *Working on:* the current request, or *No request in progress.*, the number of requests in the queue, and **Open the agent**.
- The preview's state: *The preview matches production.* or what changed, with **Approve and publish** and **Discard**, and **See the preview**.
- **Latest version**: the last release and **See the versions**.
- **What is missing**: a checklist of what still needs you, for example *The agent is not set up*, *Repository not prepared* (with **Prepare repository**), *No builds yet* or *The project setup failed*.

### The site view

Click the site on the Overview to open it in full screen. The bar shows the **Deployment shown** (**Live**, branch, **Last update**, **Hash**, **View logs**), lets you rotate the device and **Open in a new tab**, and **Chat** opens the agent beside the site, switching the view to the preview. Beside the selector, the preview is *Same as production* or has changes (*2 changes*; hover it for what changed).

## Who can do what

| | Owner | Member |
| --- | --- | --- |
| Ask for changes, approve, discard, roll back | Yes | Yes |
| Cancel requests | Anyone's | Their own |
| Invite and remove members | Yes | No |
| Settings (variables, domains, authentication, agent) | Yes | Read only |
| Delete the project | Yes | No |

In an [organization](/organizations/overview/), the organization's admins are owners of every project; its members are members.
