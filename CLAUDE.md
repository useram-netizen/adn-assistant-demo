# ADN Professional Matcher

The full brief is in [docs/SPEC.md](docs/SPEC.md). It is the source of truth for scope, the conversation flow, the import rules and the expected numbers. Its first section lists the owner's changes since the original brief.

How the code is built (modules, contracts, the conversation design) is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

- **Status:** M1 was reviewed. On 2026-10-17 the owner asked for M2–M5 together, deployed to Render. For further changes, anything marked OPEN uses the default given, kept in config, and is mentioned in the summary. Ask before changing anything else.
- **Members:** data/members.csv is input only; never edit it. It is committed (the GitHub repo is private) and the server loads it into memory at startup. To update members, replace the file and push.
- **Hosting:** Render, web service `adn-assistant` (https://adn-assistant.onrender.com). Pushing to `main` deploys. Only OPENAI_API_KEY must be set there; everything else has a working default.
- **Storage:** MongoDB is optional. Without MONGODB_URI, leads, gaps and events go to JSON files in `.data/` (which Render resets on each deploy).

## Rules you must follow
1. Never email real professionals unless EMAIL_MODE=live has been set on purpose. The default is EMAIL_MODE=preview.
2. Never send a visitor's name, email or phone number to OpenAI.
3. State, county and professional type must always come from validated options, never straight from AI output.
4. The widget runs in an iframe on another domain, so it must not rely on cookies or localStorage. Keep state in memory, and wrap any storage use in try/catch.
5. Keep secrets only in .env (or Render's environment settings), and never commit them. Keep .env.example complete.
6. Put all visitor-facing wording in one config file, so the client's final wording can be dropped in later.
7. The import must reproduce the expected numbers below exactly.

(For rule 7, the expected numbers are in docs/SPEC.md under "Member import". Check them with `npm run import -- data/members.csv`.)

## Where things live
- All visitor-facing wording, including the emails: server/src/config/copy.ts (the widget imports it as `@adn/copy`).
- Categories, subtypes and sheet labels: server/src/config/taxonomy.ts (`@adn/taxonomy`).
- HTTP request and response types: server/src/shared/api.ts (`@adn/api`). Domain types and interfaces: server/src/domain/types.ts.
- Environment settings: server/src/config/env.ts, documented in .env.example.
- The AI system prompt: server/src/ai/systemPrompt.ts. The model is gpt-6-luna, which needs `reasoning.effort: "none"` for temperature to be accepted.
- Checks before handing over: `npm run check` (format, lint, typecheck, unit and API tests), then `npm run test:e2e`.
