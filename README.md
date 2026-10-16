# ADN Professional Matcher

A chat-style assistant for the Amicable Divorce Network. Visitors answer a few set questions, see member professionals who serve their county, and send their request to the ones they pick. The widget is embedded on Tracy's sites (divorceamicably.com first, then amicabledivorce.net) with a small script or a plain iframe, so nothing depends on GrowthZone.

The full brief is in [docs/SPEC.md](docs/SPEC.md).

**Status: milestone M1.** It contains the monorepo, the server, the chat widget shell with a welcome step and the first message of each branch, `embed.js` (inline and bubble), the `/embed-test` page, and the embedding headers. This build is for checking that the widget displays inside GrowthZone. Members, matching, the full flow, AI and email arrive in M2 to M5.

## Requirements

- **Node.js 20.19 or newer.** Use Node 24 LTS (see `.nvmrc`). Node 20 and Node 23 are past end of life, and some test tools print engine warnings on Node 23.
- **npm 10 or 11.** npm 11 comes with Node 24. `npm install` and `npm ci` work with npm 10, but npm 10.9 has a bug that crashes when it builds the lockfile from scratch, so use npm 11 (`npx npm@11 install`) if you ever regenerate `package-lock.json`.

## Quick start

```sh
npm install
cp .env.example .env    # then fill it in; the defaults run locally as they are
npm run build           # builds the widget (web/dist) and the server (server/dist)
npm start               # http://localhost:3000
```

Open <http://localhost:3000/embed-test> to see the chatbot embedded the way a host page shows it, or <http://localhost:3000/embed-test?mode=all> for the full test page with the embed codes and the bubble and fallback versions. To try a real cross-site embed on your own machine, add `http://127.0.0.1:*` to `ALLOWED_EMBED_ORIGINS` in `.env`, restart, and open <http://127.0.0.1:3000/embed-test>. The page is then on a different origin from the widget, as it is on GrowthZone.

## Development

```sh
npm run dev          # rebuilds the widget on every change and restarts the server
npm run dev:widget   # widget only, with hot reload, at http://localhost:5173/widget/
```

`npm run dev:widget` sends `/api` calls to the server on port 3000, so run the server too (`npm run dev` or `npm start`).

| Command             | What it does                                                         |
| ------------------- | -------------------------------------------------------------------- |
| `npm run build`     | Builds the widget and the server                                     |
| `npm start`         | Runs the built server                                                |
| `npm run lint`      | ESLint (TypeScript, React hooks, accessibility, the no-storage rule) |
| `npm run format`    | Prettier                                                             |
| `npm run typecheck` | TypeScript in both workspaces                                        |
| `npm test`          | Unit and API tests (Vitest, Supertest)                               |
| `npm run test:e2e`  | Builds, then runs the Playwright tests                               |
| `npm run check`     | Format check, lint, typecheck and unit tests together                |

## Project layout

```
server/                 Node + Express + TypeScript
  src/app.ts            The one app: /api/*, /widget, /embed.js, /embed-test
  src/config/env.ts     Every .env setting, checked with zod at startup
  src/config/copy.ts    ALL visitor-facing wording (spec rule 6)
  src/security/         Helmet headers and the ALLOWED_EMBED_ORIGINS parser
  src/embed/            Builds embed.js and the /embed-test page
  static/embed.js       The embed script source (minified when served)
  test/                 Unit and API tests
web/                    React + Vite chat widget, built to web/dist and served at /widget
  src/flow/             Conversation steps and state (kept in memory)
  src/chat/             Chat components
  src/styles/widget.css Colour tokens and styles
  e2e/                  Playwright tests
data/                   The client's files (input only; never edit members.csv).
                        members.csv is not in git (member names and emails): get it from the client.
docs/SPEC.md            The brief
```

## Configuration

All settings live in `.env` in the repo root; `.env.example` lists every one with its default. The server checks them when it starts and stops with a clear message if one is wrong (for example a bad URL, or `EMAIL_MODE=live` outside production). Secrets go only in `.env`, which is never committed.

**OPEN items set to their defaults:**

- **Links:** `JOIN_URL`, `PRIVACY_URL`, `ARTICLES_URL`, `PODCAST_URL` and `BOOKING_URL` are empty, and empty links are hidden. `UK_SITE_URL` is https://amicabledivorcenetwork.co.uk.
- **Contacts and email:** `TRACY_EMAIL`, `LEAD_COPY_TO` and the sending domain (`EMAIL_FROM`) are empty.
- **Privacy:** `SHOW_PRO_CONTACT=false`, and `LEAD_RETENTION_DAYS` is empty, meaning leads are kept.
- **Embedding:** `ALLOWED_EMBED_ORIGINS` is the spec's list. Set it to `*` for the first GrowthZone test, then narrow it.

## Wording

Every word a visitor sees is in [server/src/config/copy.ts](server/src/config/copy.ts). That includes the widget, the text `embed.js` puts on the host page, the page title, and later the emails. The widget imports the same file as `@adn/copy`. The current wording is a placeholder (OPEN), so Tracy's final text can be dropped into that one file.

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

- `data-site` is passed through for tracking. Use `divorceamicably` on divorceamicably.com and a key of your choice on amicabledivorce.net (for example `amicabledivorce`). Keys use lowercase letters, digits and dashes.
- If the editor strips `data-*` attributes, put the settings in the script address instead, for example `https://YOUR-HOST/embed.js?mode=bubble&site=divorceamicably`.
- If the editor drops the `<div>`, the inline widget appears where the script tag is.
- `https://YOUR-HOST/embed-test` shows only the chatbot, embedded inline. `https://YOUR-HOST/embed-test?mode=all` shows all three versions live with the code to copy (`?mode=inline`, `bubble` or `fallback` shows one), and `&width=320`, `375`, `600` or `800` narrows the embed area.

How it works:

- `embed.js` is plain JavaScript under 5 KB with no dependencies. It creates the iframe and follows its height through `postMessage({ type: "adn:resize", height })`. It only accepts messages from `PUBLIC_BASE_URL`'s origin, sent by its own iframe.
- The inline iframe never grows taller than the browser window. Past that height the conversation scrolls inside the widget, so the newest message stays in view.
- Messages from the widget carry only a height or a close request.
- The widget keeps everything in memory: no cookies and no localStorage, which browsers often block in iframes from another site.

## Security headers

- **`/widget`:** Content-Security-Policy `frame-ancestors 'self'` plus `ALLOWED_EMBED_ORIGINS`. There is no X-Frame-Options (helmet's frameguard is off), and Cross-Origin-Resource-Policy is `cross-origin`. Scripts, styles, fonts and API calls may only come from this server.
- **`/embed.js`:** Cross-Origin-Resource-Policy `cross-origin`, so other sites can load it, and a 5-minute cache.
- **Everything else:** helmet's defaults, including X-Frame-Options `SAMEORIGIN`. The server never sends `DENY`.
- **When `PUBLIC_BASE_URL` is https:** HSTS and `upgrade-insecure-requests` are added.
- **API:** request bodies are limited to 20 KB, errors never include stack traces, and logs never include query strings, request bodies or personal details.

## Tests

```sh
npm test                               # unit and API tests
npx playwright install chromium webkit # once, to download the browsers
npm run test:e2e                       # builds, starts the server, runs Playwright
```

The Playwright tests run inside `/embed-test` on three setups: a phone at 375 px (Chromium), a desktop at 1280 px (Chromium), and an iPhone at 375 px (WebKit, the engine behind Safari). The test page is opened on `127.0.0.1` while the widget is served from `localhost`, so every test is a real cross-site embed.

The tests cover:

- both branches, Back and Start over, and typed text
- the iframe following the widget's height, and messages from other origins and other frames being ignored
- the bubble's size, close button and Esc
- the fallback iframe
- framing being refused for a site that isn't allowed
- no horizontal scroll from 320 to 800 px
- keyboard use, and axe checks for WCAG 2.2 AA
- no cookies or storage, and still working when the browser blocks storage

Set `E2E_PORT` to use a port other than 4317.

## Deployment

### Render (current)

The assistant runs on Render as the web service **adn-assistant**: https://adn-assistant.onrender.com, Starter plan, Ohio region. It deploys automatically whenever `main` on GitHub (growthguild/adn-professional-matcher, private) changes.

| Setting       | Value                                                                       |
| ------------- | --------------------------------------------------------------------------- |
| Build command | `npm ci --include=dev && npm run build`                                     |
| Start command | `npm start`                                                                 |
| Node version  | from `.nvmrc` (24)                                                          |
| Environment   | `NODE_ENV=production`, `PUBLIC_BASE_URL=https://adn-assistant.onrender.com` |
|               | `ALLOWED_EMBED_ORIGINS=*` (first GrowthZone test only; narrow it after)     |

Notes:

- `--include=dev` is required. With `NODE_ENV=production`, a plain `npm ci` skips the build tools (Vite, TypeScript) and the build fails.
- Render supplies `PORT` and handles HTTPS. Set any other settings from `.env.example` in the service's Environment page, never in git.
- If the service gets a custom domain later, change `PUBLIC_BASE_URL` to match and update the embed codes.

### Your own server

1. On the server, install Node 24 LTS, copy the repo, and run `npm ci && npm run build`.
2. Create `.env` with at least:

   ```sh
   NODE_ENV=production
   PORT=3000
   PUBLIC_BASE_URL=https://assistant.example.com
   # Only for the first GrowthZone test; narrow it afterwards.
   ALLOWED_EMBED_ORIGINS=*
   ```

3. Run `npm start` under a process manager (systemd or pm2) so that it restarts automatically.
4. Put it behind an HTTPS reverse proxy on the same machine. For example, with Caddy:

   ```
   assistant.example.com {
       reverse_proxy 127.0.0.1:3000
   }
   ```

   The app trusts `X-Forwarded-*` headers only from a proxy on the same machine (`trust proxy: loopback`). Keep port 3000 closed to the outside.

5. Check `https://assistant.example.com/api/health` and `https://assistant.example.com/embed-test`, then send the web guy the codes above.

Full deploy notes come with M5.
