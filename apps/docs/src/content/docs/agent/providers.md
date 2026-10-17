---
title: Model providers
description: Power the agent with an Anthropic API key, an Anthropic-compatible endpoint, or your Claude Pro/Max subscription.
sidebar:
  order: 5
---

The agent needs a model. You choose it once in **Account › Agent** (**Set up the agent**), and it applies to every project you own. An [organization](/organizations/settings-and-billing/) chooses its own for its projects.

The key is stored encrypted and reaches each project's Worker as a secret. The agent's sandbox never sees it: it holds a placeholder, and bohr adds the real key on the way out.

## Anthropic API key (recommended)

1. Create a key in the [Anthropic Console](https://console.anthropic.com). It starts with `sk-ant-`.
2. Under **Provider**, choose **Anthropic API key** and paste it in **Anthropic API key**.
3. **Model**: leave blank to use bohr's default, `claude-opus-5-5`, or type another Claude model id.
4. **Effort**: how much the model thinks before acting. **Model default**, **Low**, **Medium**, **High**, **Very high** or **Maximum**. More effort means more careful work and more tokens.
5. Click **Save**. bohr checks the key with Anthropic before saving.

## Compatible provider

Any API compatible with Anthropic's Messages API: OpenRouter, DeepSeek, Kimi, GLM, a LiteLLM proxy in front of other providers…

| Field | Value |
| --- | --- |
| **Base URL** | The API address before `/v1/messages`, with `https`. For example `https://openrouter.ai/api` or `https://api.deepseek.com/anthropic`. |
| **Provider's API key** | The key your provider gave you. bohr checks that the provider accepts it. |
| **Model** | Required: the model's name at the provider, such as `deepseek-chat` or `moonshotai/kimi-k2`. |
| **Effort** | Optional. Compatible providers may ignore it. |

How well the agent works depends on the model: it edits files, runs commands and follows long instructions.

## Claude subscription (Pro/Max)

Use your Claude Pro or Max plan instead of an API key. The agent runs through the official Claude Code, and usage is subject to your subscription's terms and limits.

1. Choose **Claude subscription (Pro/Max)** and click **Connect Claude subscription**.
2. Click **Authorize on claude.ai** and authorize with your Claude account.
3. Copy the code claude.ai shows, paste it in **Authorization code** and click **Finish connecting**.

Behind the scenes, bohr runs the official CLI's `claude setup-token` in an isolated container and keeps the long-lived token it creates (it starts with `sk-ant-oat01-`).

**I already have a token**: in a terminal with Claude Code installed, run:

```sh
claude setup-token
```

sign in with your account, and paste the token it shows in **Claude Code token**.

:::note
On some self-hosted instances the connection runs in the container of one of your projects. If none is ready yet, the panel says so: create a project first, or paste a token from `claude setup-token`.
:::

With a subscription, nothing is charged per request. The [budget per request](/agent/costs-and-limits/) still applies, as a safety cap estimated at API prices.

## Changing or removing

- Saving applies the new settings to every ready project at once (*Saved and applied to N projects.*). Projects that were waiting for an agent start [preparing their repository](/getting-started/first-deploy/).
- To keep the stored key and change only the model or effort, leave the key field blank.
- **Remove** (*Turn the agent off?*) deletes the key and turns the agent off in all your projects. GitHub deploys keep working.
- A project can use a different **model** than your account's: see [Project settings](/projects/settings/#agent).
