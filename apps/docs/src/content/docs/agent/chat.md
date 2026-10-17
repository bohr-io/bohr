---
title: Chat in the panel
description: Talk to the agent in the project's Agent page or beside the site view, follow its work and answer its questions.
sidebar:
  order: 1
---

Every project has one conversation with the agent, shared by all its members, on the web and on [Telegram](/agent/telegram/).

## Where to chat

- **Agent** (project menu): the full conversation, with the preview decisions.
- **Overview › site view**: open the site in full screen and click **Chat** to talk to the agent beside it. **Close the chat** hides it again.

## Sending a request

Type in **Ask for a change…** and press <kbd>Enter</kbd> (<kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line). A request can be up to 20,000 characters.

- Requests run **one at a time**, in order. While one runs, new ones wait; the chat shows **Requests in line: N**.
- Each member can have up to **5 requests waiting**.
- **Cancel the request** stops the running one (or removes it from the line). Members cancel their own requests; the owner can cancel anyone's.

## While the agent works

**The agent is working** shows a short status line that changes as it goes: *Editing src/App.vue*, *Running npm run build*, *Searching…*. The agent may also write messages to you during the run.

A request can run for at most 2 hours, within its [budget](/agent/costs-and-limits/).

## When it finishes

| Outcome | What you see |
| --- | --- |
| Changes made | A summary for a non-technical reader (a title and a few bullet points) and the card **Preview ready · version N** with **See the preview**, **See the changes on GitHub**, **Approve and publish** and **Discard**. |
| Nothing to change | The summary and *Nothing changed in the preview.* |
| A question | The agent needs a decision only you can make. It shows the question with options as buttons; tap one or type your own answer. The answer continues the same work. |
| Failed or cancelled | Why it stopped. The preview was not changed. |

Follow-up requests within the same preview continue the same conversation, so *"make it bigger"* has context. After you approve or discard, the next request starts fresh.

## When the agent is off

*"The agent is off because it has no provider yet."* The project owner (or an organization admin) must choose a [model provider](/agent/providers/). Until then the project still publishes what reaches GitHub.

## Language

The agent writes to you in the project's **Agent language** (Brazilian Portuguese, English or Spanish), set in **Settings › Agent**. On Telegram, the bot follows each person's Telegram language.
