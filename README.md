# ADN Professional Matcher

A chat-style assistant for the Amicable Divorce Network (ADN). Visitors answer a few set questions, see member professionals who serve their county (Platinum first), and send their request to the ones they pick. The widget is embedded on Tracy's sites (divorceamicably.com first, then amicabledivorce.net) with a small script or a plain iframe, so nothing depends on GrowthZone.

- The brief: [docs/SPEC.md](docs/SPEC.md). Its first section lists the owner's changes since the original brief.
- How the code is built: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- Live: https://adn-assistant.onrender.com (the chatbot on its own: `/embed-test`).

## How it works

- **Members** come from [data/members.csv](data/members.csv) (a Google Sheet export), loaded into memory when the server starts and read again every 10 minutes. The import rules in the brief run in memory; there is no database for members. 211 members, 199 of them searchable.
- **The conversation** is a set of questions: state (searchable dropdown), county (searchable dropdown), where they are in the process, an optional sentence about their situation, and the kind of professional. Then result cards (Platinum, Gold, then Silver; 6 at a time; pick up to 5), and a contact form.
- **Typed messages** are understood by OpenAI (`gpt-6-luna`), at any point. Everyday messages ("hi", "What can you do for me?", "How does this work?") get a short reply wherever the visitor is. A request such as "I'm looking for a mediator in the Boston area" is remembered: the assistant then asks "Are you in Massachusetts?", finds Suffolk County and offers mediators, each confirmed by the visitor. The AI never decides anything on its own: every state, county and professional type it returns is checked against the real lists first. With the AI off or failing, keywords still understand the common requests ("I need a divorce attorney"), and the buttons always work.
- **Leads, gaps and events** are saved as JSON files in `.data/` (or in MongoDB if `MONGODB_URI` is set; the files are then the safety net). On Render the files reset with each deploy.
- **Emails** are saved as HTML files in `server/.mail-preview/` and never sent, unless `EMAIL_MODE` says otherwise (see below).

## Requirements

- **Node.js 20.19 or newer.** Use Node 24 LTS (see `.nvmrc`). Node 20 and Node 23 are past end of life, and some test tools print engine warnings on Node 23.
- **npm 10 or 11.** npm 11 comes with Node 24. `npm install` and `npm ci` work with npm 10, but npm 10.9 has a bug that crashes when it builds the lockfile from scratch, so use npm 11 (`npx npm@11 install`) if you ever regenerate `package-lock.json`.

## Quick start

```sh
npm install
cp .env.example .env    # add OPENAI_API_KEY; everything else has a working default
npm run build           # builds the widget (web/dist) and the server (server/dist)
npm start               # http://localhost:3000
```

Open <http://localhost:3000/embed-test> to see the chatbot embedded the way a host page shows it, or <http://localhost:3000/embed-test?mode=all> for the full test page with the embed codes and the bubble and fallback versions. To try a real cross-site embed on your own machine, add `http://127.0.0.1:*` to `ALLOWED_EMBED_ORIGINS` in `.env`, restart, and open <http://127.0.0.1:3000/embed-test>. The page is then on a different origin from the widget, as it is on GrowthZone.

Without `OPENAI_API_KEY` (or with `AI_ENABLED=false`) everything works with buttons only.

## Development

```sh
npm run dev          # rebuilds the widget on every change and restarts the server
npm run dev:widget   # widget only, with hot reload, at http://localhost:5173/widget/
```

`npm run dev:widget` sends `/api` calls to the server on port 3000, so run the server too (`npm run dev` or `npm start`).

| Command                              | What it does                                                             |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `npm run build`                      | Builds the widget and the server                                         |
| `npm start`                          | Runs the built server                                                    |
| `npm run import -- data/members.csv` | Dry-run report of the member import (counts, who is not searchable, why) |
| `npm run lint`                       | ESLint (TypeScript, React hooks, accessibility, the no-storage rule)     |
| `npm run format`                     | Prettier                                                                 |
| `npm run typecheck`                  | TypeScript in both workspaces                                            |
| `npm test`                           | Unit and API tests (Vitest, Supertest)                                   |
| `npm run test:e2e`                   | Builds, then runs the Playwright browser tests                           |
| `npm run check`                      | Format check, lint, typecheck and unit tests together                    |

## Updating the members

1. Replace `data/members.csv` with the new export (same columns; `.xlsx` also works if you set `MEMBERS_FILE=data/members.xlsx`).
2. Run `npm run import -- data/members.csv` to see the report: how many members, who is not searchable and why, which county entries were cleaned up or dropped, and any profession label it does not know.
3. Commit and push. Render redeploys and the new list is live. A running server also re-reads the file every 10 minutes.

If the new file cannot be used (a column was renamed, or nobody in it can be found), the server **refuses to start** and says why in its log (`members_load_failed`, for example `The member file has no "Contact Email" column`). On Render the deploy then fails and the previous version keeps running. A running server that re-reads a bad file keeps the list it has. Excel's plain "CSV" export (Windows-1252) is read correctly, but "CSV UTF-8" is the safer choice.

Manual decisions go in `data/member-overrides.json`, keyed by email, for example `{ "x@y.com": { "exclude": true, "reason": "Left the network" } }`. They are applied after every other rule.

The report on the current file matches the brief exactly: 213 rows → 211 members; tiers silver 121, gold 51, platinum 34, none 5; 199 searchable (silver 115, gold 50, platinum 34); 49 county entries cleaned; 6 dropped.

## Project layout

```
server/                  Node + Express + TypeScript
  src/app.ts             The one app: /api/*, /widget, /embed.js, /embed-test
  src/index.ts           Startup: settings, members, storage, email, AI
  src/config/env.ts      Every setting, checked with zod at startup
  src/config/copy.ts     ALL visitor-facing wording and the emails (spec rule 6)
  src/config/taxonomy.ts Categories, subtypes, the sheet's profession labels
  src/members/           The import rules, matching, result cards, the in-memory list
  src/geo/               States and counties (data/us-counties-2020.csv)
  src/ai/                OpenAI client, the system prompt, the four calls, limits
  src/routes/            /api routes: geo, match, ai, leads, events, admin
  src/leads/, src/email/ Lead handling, retries, email templates and the three modes
  src/storage/           JSON files, MongoDB, and the fallback between them
  src/security/          Helmet headers, rate limits, the embed-origin parser
  static/embed.js        The embed script source (minified when served)
  test/                  Unit and API tests; test/support has a fake OpenAI
web/                     React + Vite chat widget, built to web/dist and served at /widget
  src/flow/              The conversation (a plain TypeScript controller) and its options
  src/chat/              Components: messages, dropdown, cards, form, layout
  src/styles/widget.css  Colour tokens and styles
  e2e/                   Playwright browser tests
data/                    members.csv, us-counties-2020.csv, member-overrides.json
docs/                    SPEC.md (the brief), ARCHITECTURE.md
```

## Configuration

All settings live in `.env` in the repo root (on Render: the service's Environment page). `.env.example` lists every one with its default. The server checks them when it starts and stops with a clear message if one is wrong. Secrets go only in `.env`, which is never committed.

**On Render only `OPENAI_API_KEY` is needed.** The public address comes from `RENDER_EXTERNAL_URL` (Render sets it) unless `PUBLIC_BASE_URL` is set, and Render's proxy is trusted automatically.

**Emails.** `EMAIL_MODE` is `preview` by default: nothing is sent, each email is saved as an HTML file with who it was meant for. `redirect` sends everything to `EMAIL_REDIRECT_TO` with the real recipient in the subject (for testing with the real SMTP account). `live` really sends to professionals and is refused unless `NODE_ENV=production`. Both `redirect` and `live` also need `SMTP_HOST` and `EMAIL_FROM` (and `live` needs `TRACY_EMAIL`): without them the server stops at startup instead of telling visitors "sent" while every email fails.

The form answers as soon as the request is saved; emails go out in the background and failures are retried (30 seconds, 2 minutes, 10 minutes). The visitor's confirmation email lists who was contacted and repeats nothing they typed except a plain first name; one address gets at most 5 confirmations a day.

**OPEN items set to their defaults** (see the list at the end): the links (`JOIN_URL`, `PRIVACY_URL`, `ARTICLES_URL`, `PODCAST_URL`, `BOOKING_URL`; empty links are hidden), `TRACY_EMAIL`, `LEAD_COPY_TO`, `EMAIL_FROM`, `SHOW_PRO_CONTACT=false`, `LEAD_RETENTION_DAYS` (empty: keep), and `ALLOWED_EMBED_ORIGINS` (the brief's list; set `*` for a first GrowthZone test, then narrow it).

## Wording

Every word a visitor sees, and the emails, is in [server/src/config/copy.ts](server/src/config/copy.ts). The widget imports the same file as `@adn/copy`. The wording is a placeholder (OPEN), so Tracy's final text can be dropped into that one file.

## Embedding (for Tracy's web guy)

Replace `YOUR-HOST` with the server's address. The server must be on **https**, because the host sites are https.

**Inline** (the default). It shows the assistant in the page, fills the column's width, and grows as the conversation grows:

```html
<div id="adn-assistant"></div>
<script
  src="https://YOUR-HOST/embed.js"
  data-target="adn-assistant"
  data-site="divorceamicably"
  async
></script>
```

**Bubble.** It adds a "Find a professional" button at the bottom right of the page. The button opens the assistant in a panel (about 400×640, full screen on phones). The close button and Esc close it. Use it once per page:

```html
<script
  src="https://YOUR-HOST/embed.js"
  data-mode="bubble"
  data-site="divorceamicably"
  async
></script>
```

**Fallback**, only if the page editor removes `<script>` tags. It has a fixed height, and the conversation scrolls inside it:

```html
<iframe
  src="https://YOUR-HOST/widget?site=divorceamicably"
  title="Find a divorce professional"
  style="width:100%;height:760px;border:0"
></iframe>
```

Notes:

- `data-site` is passed through for tracking and shown in the emails (`divorceamicably` becomes "divorceamicably.com", `amicabledivorce` becomes "amicabledivorce.net"). Keys use lowercase letters, digits and dashes.
- If the editor strips `data-*` attributes, put the settings in the script address instead, for example `https://YOUR-HOST/embed.js?mode=bubble&site=divorceamicably`.
- If the editor drops the `<div>`, the inline widget appears where the script tag is. If the editor re-inserts the script, the copy that carries the settings is the one used.
- `https://YOUR-HOST/embed-test` shows only the chatbot, embedded inline. `https://YOUR-HOST/embed-test?mode=all` shows all three versions live with the code to copy (`?mode=inline`, `bubble` or `fallback` shows one), and `&width=320`, `375`, `600` or `800` narrows the embed area.

How it works:

- `embed.js` is plain JavaScript under 5 KB with no dependencies. It creates the iframe and follows its height through `postMessage({ type: "adn:resize", height })`. It only accepts messages from `PUBLIC_BASE_URL`'s origin, sent by its own iframe.
- The inline iframe never grows taller than the browser window. Past that height the conversation scrolls inside the widget, so the newest message stays in view.
- On a phone the bubble's panel is full screen and modal, and the page behind it does not scroll.
- Messages from the widget carry only a height or a close request.
- The widget keeps everything in memory: no cookies and no localStorage, which browsers often block in iframes from another site.

## Security headers and privacy

- **`/widget`:** Content-Security-Policy `frame-ancestors 'self'` plus `ALLOWED_EMBED_ORIGINS` (none at all when it is `*`). There is no X-Frame-Options (helmet's frameguard is off), and Cross-Origin-Resource-Policy is `cross-origin`. Scripts, styles, fonts and API calls may only come from this server.
- **`/embed.js`:** loadable from any site, cached for 5 minutes.
- **Everything else:** helmet with a strict custom CSP, including X-Frame-Options `SAMEORIGIN`. The server never sends `DENY`.
- **When `PUBLIC_BASE_URL` is https:** HSTS and `upgrade-insecure-requests` are added.
- **API:** request bodies are limited to 20 KB; every input is checked with zod; errors never include stack traces. Rate limits per address: AI 20 a minute, match 30 a minute, usage events 30 a minute, leads and the Tracy form 5 an hour. An IPv6 visitor counts per /64 (their provider gives them the whole block); behind Render the visitor address comes from Cloudflare's `CF-Connecting-IP`, and without it only the proxy-added end of `X-Forwarded-For` is trusted. The counters never hold more than 50,000 addresses.
- **Usage events** (`POST /api/events`): every value must come from a fixed list (screens, option ids, state and county codes), so nothing typed can be stored; results and no-match events are recorded by the server from the search itself; 400 events per session; the events log stops growing at 25 MB (gaps at 5 MB). Leads, gaps and events are written as files only the server's user can read.
- **Privacy:** logs never contain names, emails, phone numbers or chat text. Nothing a visitor types is stored (`STORE_TRANSCRIPTS` has no effect). The AI only receives their typed text, after emails and phone numbers (also spaced out, spelled out or written with odd separators) and names given as "my name is…", "I'm…", "this is…" or "…here" have been replaced; if an "@" is still left, nothing of the text is sent. A line under the text box asks visitors not to type names or contact details. The contact form never goes near the AI. Leads are kept until `LEAD_RETENTION_DAYS` (if set) says otherwise.
- **Admin** (needs `ADMIN_TOKEN` of 24 or more characters, for example `openssl rand -hex 24`; off while it is empty; ten wrong tokens from one address and it waits 15 minutes), as `Authorization: Bearer <token>`:
  - `GET /api/admin/stats?from=2026-10-01&to=2026-10-31`: sessions, sessions that reached results, leads, match rate, AI calls and failures, leads per member.
  - `GET /api/admin/gaps.csv`: searches nobody covers, grouped by state, county and kind of professional (what Tracy can use to recruit members).

## Tests

```sh
npm test                               # unit and API tests (about 430)
npx playwright install chromium webkit # once, to download the browsers
npm run test:e2e                       # builds, starts the servers, runs Playwright
```

- **Unit and API tests** include the brief's exact import numbers and the six matching spot checks on the real member list, every route, the AI client (retries, rejected options, fallbacks), storage, the email modes, and the widget's conversation logic and components.
- **Browser tests** run inside `/embed-test` on three setups: a phone at 375 px (Chromium), a desktop at 1280 px (Chromium), and an iPhone at 375 px (WebKit, the engine behind Safari). The test page is opened on `127.0.0.1` while the widget is served from `localhost`, so every test is a real cross-site embed. They cover the main path, the UK and professional branches, no match → Tracy form, typed answers → "Did you mean…?", the AI-off path, the safety card, the bubble, accessibility (axe, WCAG 2.2 AA) and keyboard use.
- The browser tests use a fake OpenAI (`server/test/support/mockOpenAI.ts`) and never call the real one. Set `E2E_PORT` to use ports other than 4317-4319.

## Deployment

### Render (current)

The assistant runs on Render as the web service **adn-assistant**: https://adn-assistant.onrender.com, Starter plan, Ohio region. It deploys automatically whenever `main` on GitHub (growthguild/adn-professional-matcher, private) changes.

| Setting       | Value                                                                                 |
| ------------- | ------------------------------------------------------------------------------------- |
| Build command | `npm ci --include=dev && npm run build`                                               |
| Start command | `npm start`                                                                           |
| Node version  | from `.nvmrc` (24)                                                                    |
| Environment   | `NODE_ENV=production`, `OPENAI_API_KEY` (secret), `ALLOWED_EMBED_ORIGINS` (see above) |

Notes:

- `--include=dev` is required. With `NODE_ENV=production`, a plain `npm ci` skips the build tools (Vite, TypeScript) and the build fails.
- Render supplies `PORT` and handles HTTPS. Set any other settings from `.env.example` in the service's Environment page, never in git.
- If the service gets a custom domain later, set `PUBLIC_BASE_URL` to match and update the embed codes.
- In Render, set **Settings → Health Check Path** to `/api/health`. It answers `{ ok, version, members, storage, ai }`, so it also shows how many members are loaded and whether the AI is on.

### Your own server

1. Install Node 24 LTS, copy the repo, and run `npm ci && npm run build`.
2. Create `.env` (at least `NODE_ENV=production`, `PORT` and `PUBLIC_BASE_URL=https://assistant.example.com`).
3. Run `npm start` under a process manager (systemd or pm2) so that it restarts automatically.
4. Put it behind an HTTPS reverse proxy on the same machine, for example with Caddy:

   ```
   assistant.example.com {
       reverse_proxy 127.0.0.1:3000
   }
   ```

   The app trusts `X-Forwarded-*` headers only from a proxy on the same machine (`TRUST_PROXY` changes that). Keep port 3000 closed to the outside.

## If something does not work

- **A visitor sees "I couldn't connect just now".** Their browser got no answer from the server (a dropped connection, a captive wifi page, a blocking network). The widget already tried again. Once their connection is back, the server log shows a `client_api_errors` line saying which requests failed (for example `states:0:network`). If those lines appear for many visitors at once, look at the server.
- **The AI does not understand typed messages.** The chat still works with buttons. Look in the server log for `ai_failed` or `ai_model_unavailable`: it says why and what to change (for example `OPENAI_MODEL` if the model is not available to the key, `OPENAI_API_KEY` if the key was rejected, or the OpenAI billing if the account has no credit). `GET /api/health` shows `"ai": "on"` or `"off"`.
- **No professionals show up for a county.** That search is saved as a gap (`/api/admin/gaps.csv`) and the visitor is offered the Email Tracy form. `npm run import -- data/members.csv` shows who is not searchable and why.
- **A member is missing.** Check the import report: members need a tier, a profession that is not only "Legal", a US state and an email, and (below Platinum) at least one county that was recognised.
- **The assistant shows a blank box on the host page.** The host site's address is not in `ALLOWED_EMBED_ORIGINS` (the browser refuses to show the widget there and only says so in its console). Add the site, for example `https://www.divorceamicably.com`, or `*` while testing.
- **The server will not start and says "No searchable members".** The member file could not be used: the line before it (`members_load_failed`) names the problem.
- **Nothing was emailed.** That is the default: look in `server/.mail-preview/` (on Render, the files live only until the next deploy), or set `EMAIL_MODE=redirect` with `EMAIL_REDIRECT_TO` to test real sending.

## Still open (use the defaults until confirmed)

- The final question wording and the category labels (all in `copy.ts`).
- Which site and page, and inline versus bubble.
- The join, privacy, articles, podcast and booking links.
- Tracy's email address, and whether she gets a copy of every lead.
- Whether result cards show professionals' contact details.
- The sending domain for emails (`EMAIL_FROM`) and the SMTP account.
- How long to keep leads.
- Brand colours and the logo.
- Members: Susan Guthrie (listed only as a supporter); Adam Rettemnier, Jackie Lynch, Molly Rosenblum and Anastasia McCargo (no counties); Jason Wiggam (listed only as "Legal", so he never appears in a search).
- GrowthZone shows 325 active members, but the file has 211.
- Whether GrowthZone displays the iframe (to be tested by Tracy's web person).

### What the review found in the member data

These are facts about the file, not bugs; none changes the import numbers.

- **Andrew Hatherley** (Platinum) lists 50 states, though Platinum is meant to pick up to 9. He alone makes the mediator and financial searches match in 3,142 of 3,143 counties, so Tracy will never see a gap for those two, and he appears in the first group everywhere.
- **Partial Platinum county lists:** 21 of the 34 Platinum members list only some counties (or none) but are shown statewide, as the brief says (rule 9). Examples: Teresa DeFord (5 Houston-area counties), Hannah Hembree Bell (11 in Texas), Joerika Stitt (11 in Illinois).
- **Parent label only:** members who list only a parent label (for example "Financial") are never found by a subtype search: Yetnayet (Yetti) Esatu, Emily Akers, Kathleen Shack, Sheri Hardin, Anne MacIver, Jenn MG, Sarah Thress, Anastasia Galichanina.
- **Several states, non-Platinum:** a county name is looked up in every state the member lists, so Jennifer Brown's 298 entries become 387 counties (Keli Hazel 400 → 489, Jason Roth 159 → 190). Meredith Buck has no counties in CO or CA.
- **Coverage:** counties with at least one match, out of 3,143: divorce attorney 27% (19 states), coach 24% (12 states), therapist 8% (2 states), paralegal 2 states, bankruptcy attorney 2 counties in 1 state.
- **Names on the cards** are shown as they are in the file, and a few contain titles or roles ("Tracy Moore-Grant Attorney/Mediator, Founder-ADN", "Hello Pam Evans", "Tami Wollensak VP - Divorce Mortgage", "Keli Hazel, CPA, BFA"). Corrections can go in `data/member-overrides.json`.

## Before going live

1. **Narrow `ALLOWED_EMBED_ORIGINS`** from `*` to the real sites (the brief's list is the default).
2. **Set `JOIN_URL`** (the professional path shows no button without it). The likely page, from ADN's own site: `https://members.amicabledivorcenetwork.com/membership-application/Fill/r4qzYhQp` ("JOIN → Apply for Membership"). Tracy to confirm. Also `PRIVACY_URL`, and the articles, podcast and booking links if wanted.
3. **Set `ADMIN_TOKEN`** (24+ random characters) to switch on the stats and the gaps CSV.
4. **Emails:** set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` and `TRACY_EMAIL`; test with `EMAIL_MODE=redirect` and `EMAIL_REDIRECT_TO` first; only then `EMAIL_MODE=live`. The spec's redirect test with the real SMTP account has not been done (it needs those settings).
5. **Protect the contact form.** Once `EMAIL_MODE=live`, the form can email any address and any selected professional, limited only to 5 requests an hour per address (and 5 confirmations a day per email address). Before a public launch add a check that a person is filling it in (for example Cloudflare Turnstile) or confirm the visitor's address first.
6. **OpenAI:** set a monthly spend limit for the project in the OpenAI dashboard. The app limits calls (20 a minute per address, 300 a minute overall), but a session id is chosen by the browser, so the per-session budget is only a courtesy. The key was pasted into a chat during setup: rotate it and update it on Render.
7. **Render:** set the health check path to `/api/health` (Settings → Health Check Path).
8. The leads, gaps and events files reset with each deploy on Render. Add MongoDB (`MONGODB_URI`) or a persistent disk if leads must survive deploys.
