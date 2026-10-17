---
title: Start from a template
description: Create a project from one of bohr's ready-made sites, with its own repository and D1 database.
sidebar:
  order: 5
---

A template is a small, useful site you can publish right away and then change by asking the agent. bohr creates a **GitHub repository** from the template, a **D1 database** in your Cloudflare account, and publishes the site.

## Create it

1. Click **New project** and, under **How to start**, choose **A template**.
2. Pick a template.
3. Fill in:
   - **Project name**: also the name of the GitHub repository (letters, numbers, `.`, `-` and `_`).
   - **Owner**: where the repository is created on GitHub, **My personal account** or one of your organizations. The project runs in that owner's Cloudflare account.
   - **Private repository**: only people with access to the repository see the code. The published site is open either way.
4. Click **Create the project**. GitHub asks you to authorize bohr to create the repository on your behalf.

Your Cloudflare token needs the **D1: Edit** permission. Without it, the panel says *"The Cloudflare token cannot create D1 databases."* and links to **Edit the token on Cloudflare**.

## The admin password

Every template has an admin area at `/admin`. bohr generates its password and shows it **once**, under **Admin area password**: save it then. It is the `ADMIN_PASSWORD` [site variable](/projects/variables/), where you can change it later.

The site is online as soon as the first deploy finishes (a few minutes).

## The templates

Every template is one Cloudflare Worker ([Hono](https://hono.dev) API plus static files) with a D1 database. Its pages speak Brazilian Portuguese, English and Spanish, following the visitor's browser.

| Template | What you get |
| --- | --- |
| **Waitlist** | A launch page that collects names and emails of interested people, without duplicates, with an admin to see, search and export sign-ups as CSV. Each visitor sees their position in line. |
| **Booking** | An online booking page where customers pick a service, a day and a free time, with an admin to confirm bookings and manage services and opening hours. Bookings never overlap. |
| **Link in bio** | A page with your photo, bio and all your links, with click counts per link and an admin to edit, hide and reorder them. |
| **Forms and surveys** | Build forms with text, email, multiple choice and star rating questions, share the link and see the answers as charts or export them as CSV. |
| **Digital menu** | An online menu with a cart where customers build their order and send it on WhatsApp, with an admin to manage orders, items and prices. |
| **Short links** | A URL shortener on your own domain, with custom links, clicks per day and an admin to create, edit and turn links off. |

The templates' source is public in the `bohr-io/template-<name>` repositories on GitHub (for example `bohr-io/template-waitlist`).

## How a template project is set up

- `wrangler.jsonc` gets the Worker's name (the project name) and the new database.
- `.bohr/deploy.json` and `.bohr/preview.json` tell bohr how to deploy and preview it.
- Database schema changes are new files in `migrations/`; each production deploy applies them first (see [D1 databases](/deploys/d1-databases/)).

From there it is a project like any other: ask the agent for changes. Each template's README lists ideas, such as *"Send a welcome email to each new sign-up"* for the waitlist.

If something fails after GitHub created the repository, bohr undoes what it created (database, project) except the repository, and the error message names it.
