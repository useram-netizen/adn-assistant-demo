import { createHash, timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Config } from '../config/env.js';
import type { DateRange, GapRecord, MemberDirectory, Store } from '../domain/types.js';
import { sendValidationError } from './validate.js';
import { FixedWindowCounter, clientIp } from '../security/rateLimit.js';

export interface AdminRouterDeps {
  config: Config;
  store: Pick<Store, 'listEvents' | 'listLeads' | 'listGaps'>;
  directory: Pick<MemberDirectory, 'get'>;
}

/** Compares in constant time, whatever the lengths (both sides are hashed first). */
function sameToken(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

const day = z.iso.date();
const rangeQuery = z.object({ from: day.optional(), to: day.optional() });

/** `to` is the whole of that day. */
function toRange(query: z.output<typeof rangeQuery>): DateRange {
  return {
    ...(query.from ? { from: new Date(`${query.from}T00:00:00.000Z`) } : {}),
    ...(query.to ? { to: new Date(`${query.to}T23:59:59.999Z`) } : {}),
  };
}

/** A CSV cell: quoted when needed, and made harmless if a spreadsheet would run it as a formula. */
export function csvCell(value: string | number | null): string {
  let text = value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** No-match searches, grouped by state, county, category and subcategory, most frequent first. */
export function gapsCsv(gaps: readonly GapRecord[]): string {
  const groups = new Map<string, { gap: GapRecord; count: number }>();
  for (const gap of gaps) {
    const key = [gap.state, gap.countyFips, gap.category, gap.subcategory ?? ''].join('|');
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { gap, count: 1 });
  }
  const rows = [...groups.values()].sort(
    (a, b) =>
      b.count - a.count ||
      a.gap.state.localeCompare(b.gap.state) ||
      a.gap.county.localeCompare(b.gap.county),
  );
  const lines = [
    'state,county_fips,county,category,subcategory,count',
    ...rows.map(({ gap, count }) =>
      [gap.state, gap.countyFips, gap.county, gap.category, gap.subcategory, count]
        .map(csvCell)
        .join(','),
    ),
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * GET /admin/stats and GET /admin/gaps.csv, mounted under /api. They need
 * "Authorization: Bearer <ADMIN_TOKEN>". With no ADMIN_TOKEN set the admin routes are off (404).
 */
export function adminRouter({ config, store, directory }: AdminRouterDeps): Router {
  const router = Router();
  // Ten wrong tokens from one address in a quarter of an hour, and that address waits.
  const wrongTokens = new FixedWindowCounter(15 * 60_000, 10);

  const guard: RequestHandler = (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const expected = config.adminToken;
    if (!expected) {
      res.status(404).json({ error: 'admin_disabled' });
      return;
    }
    const who = clientIp(req, config.platform);
    if (wrongTokens.blocked(who)) {
      res.setHeader('Retry-After', '900');
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    const header = req.headers.authorization ?? '';
    const given = /^Bearer (.+)$/i.exec(header)?.[1] ?? '';
    if (!given || !sameToken(given, expected)) {
      wrongTokens.hit(who);
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };

  router.get('/admin/stats', guard, async (req, res) => {
    const parsed = rangeQuery.safeParse(req.query);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    const range = toRange(parsed.data);
    const [events, leads] = await Promise.all([store.listEvents(range), store.listLeads(range)]);

    const sessionsWith = (...types: string[]) =>
      new Set(events.filter((event) => types.includes(event.type)).map((event) => event.sessionId));
    const started = sessionsWith('session_started');
    const reachedResults = sessionsWith('results_shown', 'no_match');
    const matched = sessionsWith('results_shown');
    const aiCalls = events.filter((event) => event.type === 'ai_call');

    const perMember = new Map<string, number>();
    for (const lead of leads) {
      if (lead.kind !== 'pros') continue;
      for (const id of lead.memberIds) perMember.set(id, (perMember.get(id) ?? 0) + 1);
    }

    res.json({
      from: parsed.data.from ?? null,
      to: parsed.data.to ?? null,
      sessions: started.size,
      sessionsReachingResults: reachedResults.size,
      leads: leads.filter((lead) => lead.kind === 'pros').length,
      tracyRequests: leads.filter((lead) => lead.kind === 'tracy').length,
      matchRate: reachedResults.size > 0 ? matched.size / reachedResults.size : null,
      aiCalls: aiCalls.length,
      aiFailures: aiCalls.filter((event) => (event.data as { ok?: boolean }).ok === false).length,
      leadsPerMember: [...perMember.entries()]
        .map(([memberId, count]) => ({
          memberId,
          name: directory.get(memberId)?.name ?? null,
          count,
        }))
        .sort((a, b) => b.count - a.count || a.memberId.localeCompare(b.memberId)),
    });
  });

  router.get('/admin/gaps.csv', guard, async (req, res) => {
    const parsed = rangeQuery.safeParse(req.query);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    const gaps = await store.listGaps(toRange(parsed.data));
    res.setHeader('Content-Disposition', 'attachment; filename="gaps.csv"');
    res.type('text/csv').send(gapsCsv(gaps));
  });

  return router;
}
