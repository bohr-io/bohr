---
title: Your first request
description: Ask the agent for a change, review it on the preview and publish it.
sidebar:
  order: 7
---

With the repository prepared, ask for something small to see the whole cycle.

1. Open the project and go to **Agent** (or open the site view on the **Overview** and click **Chat**).
2. In **Ask for a change…**, write what you want, for example:

   > Change the title on the home page to "Fresh bread every morning" and make the main button orange.

3. Press <kbd>Enter</kbd> to send (<kbd>Shift</kbd> + <kbd>Enter</kbd> adds a line break).
4. The chat shows **The agent is working** with short status lines (*Editing src/pages/index.astro*, *Running npm run build*…). You can **Cancel the request** while it runs.
5. When it finishes, the agent writes a summary of what changed and what to check, and a card **Preview ready · version 1** with:
   - **See the preview**: the site with the change, on the preview address;
   - **See the changes on GitHub**: the exact diff you are approving;
   - **Approve and publish** and **Discard**.
6. Not quite right? Just send another message, such as *"Make the button a bit bigger"*. The agent continues the same conversation and the preview gets a new version.
7. Click **Approve and publish**. bohr merges the change into production and GitHub Actions deploys it. The chat tells you when production is updated.

That's it. Next:

- [Tips for good requests](/agent/tips/)
- [The preview, approving and discarding](/agent/previews/)
- [Ask from Telegram](/agent/telegram/)
- [Invite your team](/projects/members/)
