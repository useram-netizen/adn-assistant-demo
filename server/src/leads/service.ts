import { randomUUID } from 'node:crypto';
import type { Config } from '../config/env.js';
import type {
  EventSink,
  Geo,
  Lead,
  LeadRecipient,
  Mailer,
  Member,
  MemberDirectory,
  OutgoingEmail,
  Store,
} from '../domain/types.js';
import {
  clientConfirmationEmail,
  clientTracyEmail,
  leadCopyEmail,
  professionalEmail,
  tracyEmail,
  type EmailRequest,
  type ProEmailRequest,
} from '../email/templates.js';
import { log } from '../lib/log.js';
import { matchesSafetyKeywords } from '../safety/keywords.js';
import { FixedWindowCounter } from '../security/rateLimit.js';
import type { ApiError, LeadResponse, TracyResponse } from '../shared/api.js';
import { createDelivery, type Delivery, type SetTimer } from './delivery.js';
import {
  MAX_SELECTED_MEMBERS,
  createLeadSchemas,
  invalidFields,
  isHoneypotFilled,
  type ValidLeadRequest,
  type ValidTracyRequest,
} from './validation.js';

/**
 * POST /leads and POST /contact-tracy without the HTTP layer (docs/ARCHITECTURE.md, "Email
 * and leads"). Validate; pretend success for bots (the honeypot); for a lead, check every
 * selected professional against a fresh match; save the lead; send the emails; record the
 * event. Storage and email failures never fail the request: the lead is still saved or
 * emailed, and failed emails are retried in the background.
 *
 * Logs name leads by id only: never a visitor's name, email, phone or message.
 */

export interface LeadServiceDeps {
  config: Config;
  geo: Geo;
  directory: MemberDirectory;
  store: Store;
  events: EventSink;
  mailer: Mailer;
  /**
   * Sends the emails. Pass one to wait for it at shutdown (delivery.idle()); by default the
   * service makes its own, from the mailer, store and events above.
   */
  delivery?: Delivery;
  /** False only with RATE_LIMITS=off (tests): no cap on confirmation emails per address. */
  limitsEnabled?: boolean;
  /** Waits before each retry (default 30 s, 2 min, 10 min). For tests. */
  retryDelaysMs?: readonly number[];
  /** Schedules retries (default setTimeout). For tests. */
  setTimer?: SetTimer;
  now?: () => Date;
  newId?: () => string;
}

export type SubmitResult<T> = { status: 200; body: T } | { status: 400; body: ApiError };

export interface LeadService {
  submitLead(body: unknown): Promise<SubmitResult<LeadResponse>>;
  submitTracy(body: unknown): Promise<SubmitResult<TracyResponse>>;
  /** Resolves once no email or store update is in progress (tests, graceful shutdown). */
  idle(): Promise<void>;
}

/** The Tracy recipient while TRACY_EMAIL is unset: shown in previews and redirect subjects. */
export const TRACY_EMAIL_UNSET = '(TRACY_EMAIL is not set)';

const NOT_IN_MATCH: SubmitResult<never> = { status: 400, body: { error: 'not_in_match' } };

/**
 * The form is open to anyone and emails the address typed into it, so one address gets at most
 * this many confirmations a day (the professionals still get the request).
 */
export const MAX_CONFIRMATIONS_PER_ADDRESS = 5;

function ok<T>(body: T): SubmitResult<T> {
  return { status: 200, body };
}

/** The selected members, in the visitor's order, when the ids are 1–5 unique members of the match. */
export function selectMembers(matched: readonly Member[], ids: readonly string[]): Member[] | null {
  if (ids.length < 1 || ids.length > MAX_SELECTED_MEMBERS) return null;
  if (new Set(ids).size !== ids.length) return null;
  const byId = new Map(matched.map((member) => [member.id, member]));
  const selected: Member[] = [];
  for (const id of ids) {
    const member = byId.get(id);
    if (!member) return null;
    selected.push(member);
  }
  return selected;
}

export function createLeadService(deps: LeadServiceDeps): LeadService {
  const { config, geo, directory, store, events, mailer } = deps;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? randomUUID;
  const schemas = createLeadSchemas(geo);
  const delivery =
    deps.delivery ??
    createDelivery({
      mailer,
      store,
      events,
      retryDelaysMs: deps.retryDelaysMs,
      setTimer: deps.setTimer,
      now,
    });
  const confirmations = new FixedWindowCounter(24 * 60 * 60_000, MAX_CONFIRMATIONS_PER_ADDRESS);

  /** Whether the visitor's address may get a confirmation now (see MAX_CONFIRMATIONS_PER_ADDRESS). */
  function confirmationAllowed(address: string): boolean {
    if (deps.limitsEnabled === false) return true;
    const allowed = confirmations.hit(address.trim().toLowerCase()).allowed;
    if (!allowed) log.warn('confirmation_skipped', { reason: 'address_limit' });
    return allowed;
  }

  async function saveLead(lead: Lead): Promise<void> {
    try {
      await store.saveLead(lead);
    } catch (error) {
      // The store's error text may contain personal details: name the lead only.
      log.error('lead_store_failed', {
        leadId: lead.id,
        op: 'save',
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  function recordEvent(record: () => void, type: string): void {
    try {
      record();
    } catch (error) {
      log.error('event_record_failed', {
        type,
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  function recipient(kind: LeadRecipient['kind'], to: string, memberId?: string): LeadRecipient {
    return {
      kind,
      ...(memberId ? { memberId } : {}),
      to,
      status: 'pending',
      attempts: 0,
      updatedAt: now().toISOString(),
    };
  }

  /** The lead fields both forms share. */
  function baseLead(input: ValidLeadRequest | ValidTracyRequest) {
    const county = input.countyFips ? geo.county(input.countyFips) : undefined;
    return {
      id: newId(),
      createdAt: now().toISOString(),
      sessionId: input.sessionId,
      site: input.site,
      state: input.state,
      countyFips: input.countyFips,
      county: county?.name ?? null,
      category: input.category,
      subcategory: input.subcategory,
      stage: input.stage,
      contact: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        preferredContact: input.preferredContact,
      },
      message: input.message,
    };
  }

  function emailRequest(lead: Lead): EmailRequest {
    return {
      site: lead.site,
      contact: lead.contact,
      message: lead.message,
      stateName: lead.state ? (geo.state(lead.state)?.name ?? lead.state) : null,
      countyName: lead.county,
      category: lead.category,
      subcategory: lead.subcategory,
      stage: lead.stage,
    };
  }

  /**
   * Saves the lead, then starts sending. The visitor's answer does not wait for the mail server:
   * a slow one would make the widget give up and offer to send everything again. Sending is
   * tracked by the delivery (idle() waits for it), and failures are retried there. The
   * recipients the emails update are a copy of the saved ones.
   */
  async function saveAndSend(lead: Lead, emails: ReadonlyArray<OutgoingEmail | null>) {
    await saveLead(lead);
    void delivery.deliver({
      leadId: lead.id,
      sessionId: lead.sessionId,
      site: lead.site,
      recipients: lead.recipients.map((entry) => ({ ...entry })),
      emails,
    });
  }

  async function submitLead(body: unknown): Promise<SubmitResult<LeadResponse>> {
    const parsed = schemas.lead.safeParse(body);
    if (!parsed.success) {
      return {
        status: 400,
        body: { error: 'validation_failed', fields: invalidFields(parsed.error) },
      };
    }
    const input = parsed.data;
    if (isHoneypotFilled(input.website)) {
      log.info('honeypot_filled', { form: 'lead' });
      return ok({ ok: true, contacted: [], safety: false });
    }

    // Spec: re-run the match on the server and reject any member who isn't in it.
    const matched = directory.match(
      {
        state: input.state,
        countyFips: input.countyFips,
        category: input.category,
        categories: input.categories,
        subcategory: input.subcategory,
      },
      input.sessionId,
    );
    const members = selectMembers(matched, input.memberIds);
    if (!members) {
      log.warn('lead_not_in_match', { selected: input.memberIds.length, matched: matched.length });
      return NOT_IN_MATCH;
    }

    const copyTo = config.email.leadCopyTo;
    const confirm = confirmationAllowed(input.email);
    const lead: Lead = {
      ...baseLead(input),
      kind: 'pros',
      reason: null,
      memberIds: members.map((member) => member.id),
      recipients: [
        ...members.map((member) => recipient('professional', member.email, member.id)),
        ...(confirm ? [recipient('client', input.email)] : []),
        ...(copyTo ? [recipient('copy', copyTo)] : []),
      ],
    };

    // Validation guarantees the state and county exist; the fallbacks only satisfy the types.
    const request: ProEmailRequest = {
      ...emailRequest(lead),
      category: input.category,
      stateName: geo.state(input.state)?.name ?? input.state,
      countyName: lead.county ?? input.countyFips,
    };
    const names = members.map((member) => member.name);
    const forPros = professionalEmail(request);
    const emails: OutgoingEmail[] = [
      ...members.map((member) => ({
        kind: 'professional' as const,
        to: member.email,
        replyTo: input.email,
        ...forPros,
      })),
      ...(confirm
        ? [
            {
              kind: 'client' as const,
              to: input.email,
              ...clientConfirmationEmail(request, names, config.links),
            },
          ]
        : []),
      ...(copyTo
        ? [
            {
              kind: 'copy' as const,
              to: copyTo,
              replyTo: input.email,
              ...leadCopyEmail(request, names),
            },
          ]
        : []),
    ];

    log.info('lead_received', { leadId: lead.id, count: members.length, category: input.category });
    await saveAndSend(lead, emails);
    recordEvent(
      () =>
        events.record({
          sessionId: lead.sessionId,
          site: lead.site,
          type: 'lead_submitted',
          data: { count: members.length, category: input.category },
        }),
      'lead_submitted',
    );
    return ok({ ok: true, contacted: names, safety: matchesSafetyKeywords(input.message) });
  }

  async function submitTracy(body: unknown): Promise<SubmitResult<TracyResponse>> {
    const parsed = schemas.tracy.safeParse(body);
    if (!parsed.success) {
      return {
        status: 400,
        body: { error: 'validation_failed', fields: invalidFields(parsed.error) },
      };
    }
    const input = parsed.data;
    if (isHoneypotFilled(input.website)) {
      log.info('honeypot_filled', { form: 'tracy' });
      return ok({ ok: true, safety: false });
    }

    // Without TRACY_EMAIL, preview and redirect still produce the email (to a placeholder);
    // live mode has nowhere to send it, so that recipient fails straight away.
    const tracyTo = config.email.tracyEmail ?? TRACY_EMAIL_UNSET;
    const cannotSend = !config.email.tracyEmail && mailer.mode === 'live';
    const tracyRecipient: LeadRecipient = cannotSend
      ? { ...recipient('tracy', tracyTo), status: 'failed', lastError: 'tracy_email_unset' }
      : recipient('tracy', tracyTo);

    const confirm = confirmationAllowed(input.email);
    const lead: Lead = {
      ...baseLead(input),
      kind: 'tracy',
      reason: input.reason,
      memberIds: [],
      recipients: [tracyRecipient, ...(confirm ? [recipient('client', input.email)] : [])],
    };
    if (cannotSend) log.error('tracy_email_unset', { leadId: lead.id });

    const request = emailRequest(lead);
    const emails: Array<OutgoingEmail | null> = [
      cannotSend
        ? null
        : {
            kind: 'tracy',
            to: tracyTo,
            replyTo: input.email,
            ...tracyEmail(request, input.reason),
          },
      ...(confirm
        ? [
            {
              kind: 'client_tracy' as const,
              to: input.email,
              ...clientTracyEmail(request, config.links),
            },
          ]
        : []),
    ];

    log.info('tracy_lead_received', { leadId: lead.id, reason: input.reason });
    await saveAndSend(lead, emails);
    recordEvent(
      () =>
        events.record({
          sessionId: lead.sessionId,
          site: lead.site,
          type: 'tracy_form_submitted',
          data: { reason: input.reason },
        }),
      'tracy_form_submitted',
    );
    return ok({ ok: true, safety: matchesSafetyKeywords(input.message) });
  }

  return { submitLead, submitTracy, idle: () => delivery.idle() };
}
