# ADN Professional Matcher: architecture

How the code is organised, the contracts between modules, and the conversation design.
docs/SPEC.md is the source of truth for behaviour; this file explains how it is built.

## Decisions that change the original brief (2026-10-17)

- **Hosting:** Render, as the web service `adn-assistant` (https://adn-assistant.onrender.com). It auto-deploys from `main`.
- **Members without a database:** `data/members.csv` is committed (the GitHub repo is private) and loaded into memory when the server starts.
  - The import rules run in memory, and the result is what matching uses.
  - The list is re-read every 10 minutes.
  - To update members, replace the file and push.
  - `npm run import -- data/members.csv` prints the dry-run report. There is no `--apply` or `--sync`.
- **MongoDB is optional:** with `MONGODB_URI` set, leads, gaps and events go to MongoDB. Without it, they go to JSON Lines files in `STORAGE_DIR` (default `.data/`).
  - A missing or failing database never crashes or blocks anything; writes fall back to the files.
  - Render's disk resets on each deploy, and that's accepted for now.
- **Public URL:** `PUBLIC_BASE_URL`, else `RENDER_EXTERNAL_URL` (Render sets it), else `http://localhost:PORT`.
- **Situation capture:** typed text that describes the visitor's situation is kept as their situation, at any step.
  - The situation step is then skipped, and the text is used for suggestions and the form pre-fill. The interpret call returns `sharesSituation`.
- **`/embed-test`:** shows only the chatbot by default; `?mode=all` shows the full test page.

## Rules (from the brief)

1. No real emails unless `EMAIL_MODE=live`, which is allowed only with `NODE_ENV=production`. The default is `preview`.
2. Never send a visitor's name, email or phone to OpenAI.
   - Contact form data never reaches the AI module.
   - Visitor text is scrubbed of emails and phone numbers before it is sent.
3. State, county and professional type always come from validated options.
   - The server builds every option list itself.
   - AI output is accepted only if it is one of those ids.
4. The widget keeps everything in memory: no cookies, and no local or session storage (ESLint enforces this).
5. Secrets only in `.env` or Render's environment. `.env.example` lists every setting.
6. Every visitor-facing word is in `server/src/config/copy.ts`, including the emails.
7. The import reproduces the expected numbers in SPEC.md exactly; tests check them.

Logs never contain visitor names, emails, phone numbers or chat text. Log ids, codes, counts and timings only, and use `redact()` for third-party error text.

## Layout

```
server/src/
  app.ts, index.ts, routes/api.ts   wiring (integration)
  config/env.ts                     settings (zod) — every env var
  config/copy.ts                    ALL wording (@adn/copy in the widget)
  config/taxonomy.ts                categories, subtypes, sheet labels (@adn/taxonomy)
  shared/api.ts                     HTTP request/response types (@adn/api)
  domain/types.ts                   Member, Lead, Store, Mailer, … interfaces
  security/                         headers, embed origins, rateLimit + clientIp
  safety/keywords.ts                matchesSafetyKeywords(text)
  geo/                              states + counties (Geo)
  members/                          import rules, report, matching, cards,
                                    MemberDirectory, file reading (CSV/XLSX)
  cli/import.ts                     npm run import -- <file>
  routes/geo.ts, routes/match.ts    GET /states, /counties; POST /match
  storage/                          FileStore, MongoStore, ResilientStore,
                                    MemoryStore (tests), createStore()
  events/                           event schemas, EventSink
  routes/events.ts, routes/admin.ts POST /events; GET /admin/*
  jobs/retention.ts                 LEAD_RETENTION_DAYS purge
  email/                            templates, createMailer()
  leads/                            lead + Tracy services, retries
  routes/leads.ts                   POST /leads, /contact-tracy
  ai/                               OpenAI client, system prompt, 4 calls
  routes/ai.ts                      POST /ai/interpret|county|situation|recommend
web/src/                            the chat widget
```

Conventions:

- **TypeScript:** ESM with `.js` import extensions on the server, and `strict` plus `noUncheckedIndexedAccess` everywhere.
- **Validation:** zod for every request body and query. A bad request gets `400 { error: 'validation_failed', fields: [...] }`.
- **Tests:** Vitest; supertest for routes, mounted on a small `express()` app with `express.json({ limit: '20kb' })`.
- **Checks:** Prettier and ESLint must pass (`npx prettier --check <files>`, `npx eslint <files>`).

## Router contracts (wired in routes/api.ts under /api)

Each router owns its paths, relative to `/api`:

```ts
geoRouter({ geo }): Router                                   // GET /states, GET /counties?state=GA
matchRouter({ config, geo, directory, store, rateLimitEnabled }): Router   // POST /match
aiRouter({ config, geo, events, client, rateLimitEnabled }): Router        // POST /ai/interpret|county|situation|recommend
leadsRouter({ config, geo, directory, store, events, mailer, rateLimitEnabled }): Router // POST /leads, /contact-tracy
eventsRouter({ config, store, rateLimitEnabled }): Router   // POST /events
adminRouter({ config, store, directory }): Router           // GET /admin/stats, /admin/gaps.csv
```

- **Rate limits:** each router builds its own limiter with `rateLimit({ name, ...RATE_LIMITS.x, platform: config.platform, enabled: rateLimitEnabled })` from `security/rateLimit.ts`. `rateLimitEnabled` is false only when `RATE_LIMITS=off` (end-to-end tests).
- **Services:** created by `index.ts`:
  - `createGeo(config.paths.countiesFile)`
  - `createMemberDirectory({ config, geo })`, which loads now and reloads every 10 minutes
  - `createStore(config)` and `createEventSink(store)`
  - `createMailer(config)`
  - `createAiClient(config)`, which is null when the AI is off or there is no key

## Data: geo, import, matching

- **Geo:** loads `data/us-counties-2020.csv` (state, fips, name, aliases separated by "|") and the 50 states + DC (USPS code, name).
  - `shortCountyName` drops a trailing " County" or " Parish" ("Fulton County" → "Fulton"; "Baltimore city" stays as it is).
- **Import:**
  - Reads CSV, or XLSX (`read-excel-file/node`). The column names are as in SPEC.md, and the header typo "AND" is the name.
  - Apply the rules in SPEC.md in order (empty rows, ids, merging, tiers, professions, states, counties, state inference, Platinum, founding, searchable, overrides) and return `{ members, report }` (`ImportReport`).
  - Label matching ignores case and the spaces around "-".
  - County names are compared ignoring case, accents, spaces and punctuation.
  - Expected numbers (all must match): see SPEC.md "Expected dry-run result".
- **Overrides:** `data/member-overrides.json` holds `{ "email": { "exclude": true, "reason": "…" } }`, applied last. An excluded member gets the reason code `excluded`.
- **Matching:** a member matches when they are searchable and active, have the category (and the subtype, if one was picked), and are either:
  - Platinum with that state, or
  - non-Platinum with that state and county.
  - Order: Platinum, Gold, then Silver, each tier shuffled with a deterministic PRNG seeded from the session ID (plus the tier).
- **Cards (`ProfessionalCard`):**
  - Display labels come from `copy.cards.professionLabels`: the requested category (and subtype) first, then the rest, with duplicates removed.
  - Service area: `copy.cards.servesAllOf` for Platinum. Otherwise up to 3 short county names, the visitor's county first, using `serves` or `servesMore`.
  - Badges: platinum or gold (Silver gets none), then cadp and founding.
  - The email is included only when `SHOW_PRO_CONTACT=true`.
- **POST /match:**
  - Validate `state` (one of the 51), `countyFips` (in that state), `category` (a key), and `subcategory` (null, "any", or a subtype of the category).
  - Respond with `MatchResponse`.
  - When there are no matches, also save a gap with `store.saveGap({ createdAt, site, state, countyFips, county, category, subcategory })`. A storage error never fails the request.
- **Spot checks** (Platinum / Gold / Silver):
  - GA Fulton (13121) attorney: 6/10/19
  - GA Fulton financial (any): 13/1/4
  - IL Cook (17031) mediator: 3/0/10
  - TX Harris (48201) attorney: 3/1/1
  - NV Clark (32003) attorney: 0/1/8
  - WY Teton (56039) attorney: no match

## Storage, events, admin

- **`createStore(config)`:**
  - With `MONGODB_URI`: a `ResilientStore` that tries MongoDB (official driver, short timeouts, lazy connect, indexes) and falls back to the file store on any error, logging `storage_fallback` with no personal data.
  - Without it: a `FileStore` in `config.paths.storageDir`, using JSON Lines with serialized appends and atomic rewrites for lead updates. The folder is 0700 and the files 0600. The events log stops growing at 25 MB and the gaps log at 5 MB (leads never are limited); a full log says so once an hour (`storage_file_full`).
  - Collections and files: `leads`, `gaps`, `events`.
  - `init()` never throws.
- **POST /events:**
  - Body: `EventsRequest`. The type must be in `CLIENT_EVENT_TYPES`, and the data must match that type's exact shape in `EventDataByType` (no extra keys). Screens come from `STEP_IDS` (shared/api.ts); an answer is a state code, a county code or one of the named option ids (events/schemas.ts), so nothing typed can be stored.
  - At most 50 events a request, 30 requests a minute per address, 400 events per session (the rest are ignored, with a 204). `at` is an ISO date.
  - Store with `source: 'client'` and `receivedAt`. Respond `204`.
- **`EventSink.record()`:** records server-side events without blocking: `ai_call`, `lead_submitted`, `tracy_form_submitted`, `email_failed`, and `results_shown` / `no_match`, which POST /match records from the real search (the widget does not send those two).
- **Rate limiter (security/rateLimit.ts):** a fixed window per key; the key is the visitor's address, with IPv6 counted per /64. Behind Render it is `CF-Connecting-IP`, else the last `X-Forwarded-For` entry (the one the proxy added). At most 50,000 keys are kept, swept every few seconds.
- **Admin:** Bearer `ADMIN_TOKEN` (24+ characters), compared in constant time. Unset → `404 { error: 'admin_disabled' }`; wrong token → `401`; ten wrong tokens from one address in 15 minutes → `429` for that address.
  - `GET /admin/stats?from=&to=`: sessions, sessions that reached results, leads, match rate, AI calls and failures, and leads per member (id, name, count).
  - `GET /admin/gaps.csv`: no-match searches grouped by state, county and category, with counts.
- **Retention:** with `LEAD_RETENTION_DAYS`, delete older leads daily.

## Email and leads

- **`createMailer(config)`:**
  - preview: writes the HTML (with To, Reply-To and Subject at the top) to `config.paths.mailPreviewDir`. Nothing is sent.
  - redirect: SMTP to `EMAIL_REDIRECT_TO`, with subject `[TEST → real@address] …` (`copy.emails.redirectSubject`).
  - live: SMTP to the real address.
  - Uses nodemailer, with `EMAIL_FROM` as the sender.
- **POST /leads (`LeadRequest`):**
  1. Validate.
  2. If the honeypot is filled, respond 200 `{ ok: true, contacted: [], safety: false }` and do nothing else.
  3. Re-run the match on the server. Any member not in it → `400 { error: 'not_in_match' }`. Allow 1–5 members.
  4. Save the lead with `kind: 'pros'`.
  5. Email each professional:
     - subject `copy.emails.pro.subject`, which uses the visitor label from `copy.categories`
     - all the client details
     - the `foundYou` line, with the site name from `copy.sites`
     - `replyTo` set to the client
  6. Send the client a confirmation listing who was contacted, plus the what's next links that are set. It repeats nothing the visitor typed except a plain first name, and one address gets at most 5 confirmations a day (the professionals still get the request).
  7. Send an optional copy to `LEAD_COPY_TO`.
  8. Record each recipient's status. Retry failures up to 3 times with backoff, update the stored lead, and record `email_failed` when a recipient gives up.
  9. Respond `{ ok: true, contacted: names, safety }`, where `safety` means the message matched the keywords. The response does not wait for the emails: sending is background work tracked by the `Delivery` (index.ts waits for `delivery.idle()` at shutdown).
- **POST /contact-tracy (`TracyRequest`):**
  - The same contact fields, with `reason` set to `no_match` or `outside`.
  - Save the lead with `kind: 'tracy'`, email `TRACY_EMAIL` (Reply-To the visitor, with location and category), and send the visitor a confirmation.
  - If `TRACY_EMAIL` is unset, preview and redirect still produce the email; live mode logs `tracy_email_unset` and marks the recipient as failed.
- **Events and limits:** record `lead_submitted` or `tracy_form_submitted`. Rate limit 5 per hour per IP for each route.

## AI

- **Client:**
  - OpenAI Responses API with Structured Outputs (`text.format: { type: 'json_schema', strict: true }`).
  - `reasoning: { effort: 'none' }` and `temperature: 0.2` by default, both verified on gpt-6-luna. If the model rejects a parameter (400 with `param`), retry once without it, remember that for the model, and log `ai_param_unsupported`.
  - `OPENAI_TIMEOUT_MS` plus 1 retry.
  - Log every call as `ai_call` (kind, ms, ok, tokens, error code; never text), and record the `ai_call` event.
  - A failure such as a missing model, a 401 or a 429 is logged with a clear reason (`ai_failed`, with the code and model), and the request falls back.
- **System prompt:** `ai/systemPrompt.ts`, word for word from SPEC.md.
- **Options:** the server builds each step's options (see `InterpretRequest` in `shared/api.ts`) from geo, taxonomy and copy.
  - Exact-match shortcut: if the text equals an option's label or id (state name or code, county name with or without "County", category label), return it with `source: 'exact'` and no AI call.
- **interpret:**
  - Returns `{ kind, optionId, reply ≤50 words, safety, sharesSituation, hints }`.
  - An option id that isn't in the list → unclear.
  - `hints` is what the text says for the questions still to come, whatever the step: `category` (a category key), `state` (a USPS code that exists in geo) and `place` (a city, county or ZIP code as written, plain text, at most 60 characters). "I'm looking for a mediator in the Boston area" at the welcome step → `divorce`, with hints mediator, MA, Boston. A professional the visitor already has ("my lawyer filed") is not a hint. The task tells the AI that the assistant shows matching professionals itself, so it never says it can't give a list.
  - `sharesSituation` is true when the visitor describes their own circumstances (for example "My husband and I decided to split. We have two kids…"), even if they also answered the question.
- **countyFromPlace:** returns a FIPS code that must be in the state's list, or null.
- **situation:** the reply is an acknowledgement of at most 40 words; `suggestedCategories` are 0–3 valid keys; the summary is at most 60 words, third person, with no names.
  - Example: "two kids, keep it civil" should suggest mediator, therapist and coach.
- **recommend:** 1–3 recommendations, each a valid category with a reason of at most 15 words.
- **Questions:** asked about a type of professional, answer generally and briefly. Asked for legal or financial advice ("Should I ask for full custody?"), decline kindly and point to the right professional (an attorney).
- **Safety:** `safety = matchesSafetyKeywords(text) || ai.safety_concern`.
- **Limits:**
  - 20 requests per minute per IP across `/ai/*` (`RATE_LIMITS.ai`)
  - `MAX_AI_CALLS_PER_SESSION` per session ID, kept in memory with a TTL
  - a global ceiling of about 300 calls per minute
  - text at most 1,000 characters
  - Over a limit → the fallback, never an error.
- **Fallbacks (AI off, no key, failure or limit):**
  - interpret → keywords (`ai/keywords.ts`): the kind of professional ("a divorce attorney"), the welcome step's two answers, US state names and big cities. A match on one of the step's options is `source: 'keyword'` (confirmed like the AI's); otherwise unclear with the hints. The exact match still works, and the keyword safety check always runs.
  - county → null
  - situation → `copy.steps.situation.ack`, with the summary set to the visitor's own text and no suggestions
  - recommend → empty recommendations
- **Privacy:** before sending, replace emails with `[email]` and phone numbers with `[phone]`. The AI module never sees contact form data.

## Widget conversation design

The whole conversation is `ChatController` (web/src/flow/controller.ts): plain TypeScript with no React in it, so the flow is tested without a browser (web/test/controller.test.ts uses a fake server). The React components only show its state and call its actions. Work that takes time (typing pauses, server calls) runs under an "epoch": Back, Start over and failures start a new epoch, so a late answer from the server can never land on a screen the visitor has left. The typing indicator (`busy`) stays on until the last run of the epoch ends, because a step that moves on from inside a run starts another one. Back restores a snapshot of the earlier step (its answers, transcript length, situation text, results and form draft).

**What the visitor says ahead of the questions.** The interpret hints are kept in `ChatState.remembered` (cleared by Start over, restored by Back) and each is used once, at its own question, where the visitor confirms it: the location step asks "Are you in Massachusetts?"; the county step looks up the remembered place with `/api/ai/county` (only in the state it was mentioned with) and goes straight to "That sounds like Suffolk County. Is that right?"; the category step asks "You mentioned a mediator. Shall I look for mediators?". Typed text that answers nothing but says what the visitor needs is acknowledged ("Got it, I'll look for divorce attorneys.") and the question is asked again, never "Sorry, I didn't catch that".

**Connection problems.** Requests that change nothing (config, states, counties, match, the AI calls) are tried again after a dropped connection or a 502/503/504 (after 0.7 s and 2 s); the contact forms never are. A request that still gets no answer says so ("I couldn't connect just now. Please check your internet connection and try again."), which is a different message from a fault on our side. Every failed request is recorded as an `api_error` event (call, status, reason; nothing the visitor typed); the tracker keeps events that could not be sent and sends them when the connection is back, and the server writes one `client_api_errors` warning per batch, so a visitor's dropped connection shows up in the server log.

State lives in memory only.

- **Session:** a session ID (a v4 UUID from `crypto.randomUUID`, with a `getRandomValues` fallback), the site, the mode, and `GET /api/config`.
- **Answers:** path, state, county, stage, category, subcategory and the selected members.
- **Situation:** `situationTexts` plus `analysis`, the last situation response.
- **Flags:** `safetyShown` and the results.

Steps (bot message from copy → input):

| step           | message                                                                                                                                                                              | input                                                                                                                                                                            | next                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| welcome        | `steps.welcome.message`                                                                                                                                                              | buttons divorce / professional                                                                                                                                                   | location / pro_info                                                                                           |
| pro_info (end) | `proInfo.message`, or `messageNoLink` while JOIN_URL is unset                                                                                                                        | link button JOIN_URL                                                                                                                                                             | —                                                                                                             |
| location       | `location.message`                                                                                                                                                                   | state combobox (GET /api/states) + buttons UK / Somewhere else                                                                                                                   | county / uk / outside                                                                                         |
| uk (end)       | `uk.message`                                                                                                                                                                         | link button UK_SITE_URL                                                                                                                                                          | —                                                                                                             |
| outside (end)  | `outside.message`                                                                                                                                                                    | button Email Tracy                                                                                                                                                               | tracy form (reason outside)                                                                                   |
| county         | `county.message` ({state})                                                                                                                                                           | county combobox (GET /api/counties) + button "I'm not sure"                                                                                                                      | stage / county_help                                                                                           |
| county_help    | `countyHelp.message`                                                                                                                                                                 | the text box → POST /api/ai/county                                                                                                                                               | confirm "That sounds like {county}…" [Yes] [No, let me pick] → stage / combobox; null → `notFound` + combobox |
| stage          | `stage.message`                                                                                                                                                                      | 4 buttons                                                                                                                                                                        | situation, or category if a situation was already shared                                                      |
| situation      | `situation.message`                                                                                                                                                                  | text box (→ POST /api/ai/situation) + Skip                                                                                                                                       | category (show the reply first)                                                                               |
| category       | `category.message`                                                                                                                                                                   | 6 main + More options + I'm not sure; "Suggested" tag on `analysis.suggestedCategories`                                                                                          | subcategory (financial, coach, therapist, real_estate) / results / category_more / category_help              |
| category_more  | `categoryMore.message`                                                                                                                                                               | the 6 more categories                                                                                                                                                            | results                                                                                                       |
| category_help  | with a situation: POST /api/ai/recommend → `recommended` + a button per recommendation (reason underneath) + See all; else `explain` + all 12 categories with `categoryExplanations` |                                                                                                                                                                                  | subcategory / results                                                                                         |
| subcategory    | `subcategory.message`                                                                                                                                                                | subtype buttons + "Any / not sure"                                                                                                                                               | results                                                                                                       |
| results        | `results.message` ({category}=plural, county, state) + `instructions`                                                                                                                | cards, 6 at a time, Show more; select 1–5 (toggle buttons, aria-pressed); "Contact selected (n)"                                                                                 | contact                                                                                                       |
| no_match       | `noMatch.message`                                                                                                                                                                    | Email Tracy / Try another type / Start over                                                                                                                                      | tracy form / category / welcome                                                                               |
| contact        | `contact.message` ({names})                                                                                                                                                          | contact form; the text box is hidden                                                                                                                                             | done                                                                                                          |
| tracy          | `tracy.message`                                                                                                                                                                      | the same form, Tracy variant                                                                                                                                                     | done (Tracy variant)                                                                                          |
| done           | `done.message` or `messageTracy`                                                                                                                                                     | what's next: articles, podcast and booking links (only those set), "Find another type of professional" (`NEXT_SUGGESTIONS` for the category, else the category step), Start over |                                                                                                               |

- **Skipping the situation step:** when the visitor already shared a situation, call POST /api/ai/situation on reaching it (stage plus the texts joined), keep the analysis, and go straight to the category step without asking.
- **Form pre-fill:** `analysis.summary` if `source === 'ai'`. Otherwise `form.prefillStage[stage]` followed by the visitor's own texts. If there are none, use `form.prefillLookingFor`.

**Typed text** (the text box) at any button step → POST /api/ai/interpret. The step is `welcome`, `location`, `county`, `stage`, `category`, `category_more`, `category_help` or `subcategory`, otherwise `other`. Then:

1. Show the visitor's message.
2. If `safety` is true and the safety card hasn't been shown yet, show the safety card and send a `safety_shown` event. Then continue.
3. If `sharesSituation` is true, add the text to `situationTexts`.
4. Handle the reply by its kind:

| kind                                                | what the widget does                                                                                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| option, with source `exact`, or at welcome or stage | Accept it directly. Show `reply` first if there is one, for example an acknowledgement.                                                                                                                       |
| option, any other step                              | "Did you mean {label}?" with Yes and No. Yes accepts the option. No shows `fallback.pickInstead` and the step's input again. For UK or Somewhere else, the label is `location.confirmUk` or `confirmOutside`. |
| question                                            | Show `reply`, then repeat the step's message and input.                                                                                                                                                       |
| unclear, or an error                                | `fallback.didNotCatch` plus the step's input again, or `didNotCatchNoOptions` when the step has no buttons.                                                                                                   |

- **Navigation:** Back returns to the previous step and clears every answer after it. Start over clears everything except the session ID and `safetyShown`.
- **Errors:** any failed request shows `widget.requestError` (or `rateLimited` on a 429) with a "Try again" button that repeats the action. Never a dead end.
- **Events:** batch them, sending every few seconds and on `pagehide` (fetch `keepalive`). Never include typed text.
- **Accessibility:**
  - Comboboxes follow the ARIA combobox pattern: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, a listbox with options, and arrow keys, Enter, Escape (with `preventDefault`, so the bubble doesn't close), Home and End.
  - Forms have labels, `aria-invalid`, error text tied with `aria-describedby`, and focus moves to the first error.
  - Focus moves to the new input after each step, but never on page load.
- **Embedding:** keep ChatLayout's height reporting and scroll handling.

## Status (2026-10-17)

M2 to M5 are built and deployed, with `EMAIL_MODE=preview`. Everything in this file is implemented; the OPEN items (wording, links, Tracy's address, brand colours, retention) use the defaults in config. Tests: about 430 unit and API tests (`npm test`) and the Playwright browser tests (`npm run test:e2e`).
