import { Router } from 'express';
import { z } from 'zod';
import type { Geo } from '../domain/types.js';
import type { CountiesResponse, StatesResponse } from '../shared/api.js';
import { sendValidationError, stateSchema } from './validate.js';

/** GET /states (the 50 states + DC) and GET /counties?state=GA, mounted under /api. */
export function geoRouter({ geo }: { geo: Geo }): Router {
  const router = Router();
  const states: StatesResponse = {
    states: geo.states().map(({ code, name }) => ({ code, name })),
  };
  const query = z.object({ state: stateSchema(geo) });

  // The lists never change while the server runs, so browsers may keep them for an hour.
  router.get('/states', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(states);
  });

  router.get('/counties', (req, res) => {
    const parsed = query.safeParse(req.query);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    const state = parsed.data.state;
    const body: CountiesResponse = {
      state,
      counties: geo.counties(state).map(({ fips, name }) => ({ fips, name })),
    };
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(body);
  });

  return router;
}
