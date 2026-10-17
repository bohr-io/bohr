---
title: Delete a project
description: Remove a project and everything bohr created for it, keeping or deleting the published site.
sidebar:
  order: 8
---

The **Danger zone** at the bottom of **Settings › General** deletes the project. Only the owner can do it, and it cannot be undone.

1. Click **Delete project**.
2. Read what goes and what stays.
3. Optional: check **Also delete the site published in my Cloudflare account**.
4. Type the project's name to confirm and delete.

## What goes

- The project's agent: its Workers (the project Worker and the preview Worker) and its container.
- The preview, bohr's hosting and bohr's routes, for projects hosted by bohr.
- The project in bohr: its members, chat, settings and variables.

## What stays

- **The GitHub repository is not changed.**
- **The site published in your Cloudflare account stays online**, unless you checked the option above. That option removes the site's production Worker and the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` Actions secrets older versions of bohr may have left in the repository, so it is not published again.
- **The project's Telegram bot keeps existing.** Delete it in @BotFather if you want.

The repository's `.github/workflows/bohr-deploy.yml` stays too. Once the project is deleted, bohr no longer gives it deploy credentials, so its runs fail; delete the file if you don't need it.

If something could not be removed, the panel says *"The project was deleted, but something was left behind"* with the list, for you to clean up by hand.
