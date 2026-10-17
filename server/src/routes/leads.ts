import { Router } from 'express';
import { createLeadService, type LeadServiceDeps } from '../leads/service.js';
import { RATE_LIMITS, rateLimit } from '../security/rateLimit.js';

export interface LeadsRouterDeps extends LeadServiceDeps {
  /** False only with RATE_LIMITS=off (end-to-end tests). */
  rateLimitEnabled: boolean;
}

/**
 * POST /leads (LeadRequest → LeadResponse) and POST /contact-tracy (TracyRequest →
 * TracyResponse), mounted under /api after the JSON body parser.
 * 400 { error: 'validation_failed', fields } names the bad fields, never their values;
 * 400 { error: 'not_in_match' } when a selected professional isn't in a fresh match.
 * Each route allows 5 requests per hour per IP.
 */
export function leadsRouter(deps: LeadsRouterDeps): Router {
  const router = Router();
  const service = createLeadService(deps);
  const limiter = (name: 'leads' | 'tracy') =>
    rateLimit({
      name,
      ...RATE_LIMITS[name],
      platform: deps.config.platform,
      enabled: deps.rateLimitEnabled,
    });

  router.post('/leads', limiter('leads'), async (req, res) => {
    const result = await service.submitLead(req.body);
    res.status(result.status).json(result.body);
  });

  router.post('/contact-tracy', limiter('tracy'), async (req, res) => {
    const result = await service.submitTracy(req.body);
    res.status(result.status).json(result.body);
  });

  return router;
}
