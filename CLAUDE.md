# ADN Professional Matcher

The full brief is in [docs/SPEC.md](docs/SPEC.md). Read it before changing anything: it is the source of truth for scope, the conversation flow, the import rules and the expected numbers.

- Work one milestone at a time (M1–M5 in the spec) and stop after each for review, with a summary of what was built and the OPEN items touched.
- Anything marked OPEN: use the default given, keep it in config, and mention it in the milestone summary. Ask before changing anything else.
- data/members.csv is input only. Never edit it.

## Rules you must follow
1. Never email real professionals unless EMAIL_MODE=live has been set on purpose. The default is EMAIL_MODE=preview.
2. Never send a visitor's name, email or phone number to OpenAI.
3. State, county and professional type must always come from validated options, never straight from AI output.
4. The widget runs in an iframe on another domain, so it must not rely on cookies or localStorage. Keep state in memory, and wrap any storage use in try/catch.
5. Keep secrets only in .env, and never commit them. Keep .env.example complete.
6. Put all visitor-facing wording in one config file, so the client's final wording can be dropped in later.
7. The import must reproduce the expected numbers below exactly.

(For rule 7, the expected numbers are in docs/SPEC.md under "Member import".)

## Where things live
- All visitor-facing wording: server/src/config/copy.ts (the widget imports it as `@adn/copy`).
- Environment settings: server/src/config/env.ts, documented in .env.example.
- Checks before handing over: `npm run check` (format, lint, typecheck, unit/API tests), then `npm run test:e2e`.
