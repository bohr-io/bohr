---
title: Tips for good requests
description: How to ask so the agent gets it right the first time.
sidebar:
  order: 8
---

The agent writes for people who do not code, and it works best with requests that say **what** you want and **where**, in plain words.

## Do

- **Name the place.** *"On the pricing page, under the three plans…"* beats *"add a note somewhere"*.
- **Describe the result, not the code.** *"Visitors should be able to send us a message with their name and email, and we get it by email"*.
- **Give the exact text** when wording matters: *"Change the headline to: Fresh bread every morning"*.
- **One change per request**, then adjust. Small requests are faster, cheaper and easier to review.
- **Say what to keep.** *"Keep the current colors"*, *"Don't change the menu"*.
- **Use follow-ups.** The agent remembers the conversation until you approve or discard: *"Now make it smaller on phones"*.
- **Mention secrets by name, never their value.** *"Use the RESEND_API_KEY variable to send the email"*, then add the variable in [Environment variables](/projects/variables/).

## Avoid

- Pasting passwords, API keys or tokens in the chat. The chat is stored and shared with all members.
- Huge, vague requests (*"redo the whole site"*). Break them into steps.
- Asking the agent to deploy or merge: approving does that.
- Asking it to change GitHub workflows: it cannot (see [capabilities](/agent/capabilities/)).

## Examples

> Add a FAQ section at the end of the home page with these three questions and answers: …

> The contact form shows an error on phones. Fix it and check it works on a small screen.

> Add a page /team with a photo, name and role for each person in this list: …

> Create a waitlist form that saves name and email in the database, and an /admin page protected by the ADMIN_PASSWORD variable to see the sign-ups.

## Review well

- Open the preview on **Phone** too.
- Read the summary: it lists what to check.
- When in doubt, **See the changes on GitHub**: it shows exactly what approving publishes.
