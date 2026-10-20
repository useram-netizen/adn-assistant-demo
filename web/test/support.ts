import type {
  CountyFromPlaceResponse,
  InterpretResponse,
  LeadRequest,
  MatchRequest,
  MatchResponse,
  ProfessionalCard,
  SituationResponse,
} from '@adn/api';
import { vi, type Mock } from 'vitest';
import { ChatController } from '../src/flow/controller';
import type { ChatState, ContactValues } from '../src/flow/types';
import { ApiError, type Api, type PublicConfig } from '../src/lib/api';
import type { Tracker } from '../src/lib/events';

export const config: PublicConfig = {
  links: {
    join: 'https://example.com/join',
    ukSite: 'https://amicabledivorcenetwork.co.uk/',
    articles: null,
    podcast: null,
    booking: null,
    privacy: 'https://example.com/privacy',
  },
  features: { ai: true, showProContact: false },
};

export const card = (
  id: string,
  tier: ProfessionalCard['tier'],
  name = `Pro ${id}`,
): ProfessionalCard => ({
  id,
  name,
  tier,
  labels: ['Divorce & family law attorney'],
  serviceArea: tier === 'platinum' ? 'Serves all of Georgia' : 'Serves Fulton, Cobb',
  badges: tier === 'silver' ? [] : [tier],
});

export const cards = [
  card('p1', 'platinum'),
  card('p2', 'platinum'),
  card('g1', 'gold'),
  card('g2', 'gold'),
  card('s1', 'silver'),
  card('s2', 'silver'),
  card('s3', 'silver'),
  card('s4', 'silver'),
];

export const unclear: InterpretResponse = {
  kind: 'unclear',
  optionId: null,
  reply: '',
  safety: false,
  sharesSituation: false,
  source: 'fallback',
};

export const option = (
  optionId: string,
  extra: Partial<InterpretResponse> = {},
): InterpretResponse => ({
  kind: 'option',
  optionId,
  reply: '',
  safety: false,
  sharesSituation: false,
  source: 'ai',
  ...extra,
});

export const analysis = (extra: Partial<SituationResponse> = {}): SituationResponse => ({
  reply: 'It sounds like a lot.',
  suggestedCategories: ['mediator', 'therapist', 'coach'],
  summary: 'They have two children and want to keep things civil.',
  safety: false,
  source: 'ai',
  ...extra,
});

export type FakeApi = { [K in keyof Api]: Mock<Api[K]> };

/** A server that answers like the real one, with calls recorded. Override what a test needs. */
export function fakeApi(overrides: Partial<Api> = {}): FakeApi {
  const api: Api = {
    config: vi.fn(() => Promise.resolve(config)),
    states: vi.fn(() =>
      Promise.resolve([
        { code: 'GA', name: 'Georgia' },
        { code: 'WY', name: 'Wyoming' },
      ]),
    ),
    counties: vi.fn((state: string) =>
      Promise.resolve(
        state === 'GA'
          ? [
              { fips: '13067', name: 'Cobb County' },
              { fips: '13121', name: 'Fulton County' },
            ]
          : [{ fips: '56039', name: 'Teton County' }],
      ),
    ),
    match: vi.fn((request: MatchRequest) =>
      Promise.resolve<MatchResponse>(
        request.state === 'WY'
          ? { results: [], total: 0, noMatch: true, counts: { platinum: 0, gold: 0, silver: 0 } }
          : {
              results: cards,
              total: cards.length,
              noMatch: false,
              counts: { platinum: 2, gold: 2, silver: 4 },
            },
      ),
    ),
    interpret: vi.fn(() => Promise.resolve(unclear)),
    county: vi.fn(() =>
      Promise.resolve<CountyFromPlaceResponse>({
        countyFips: null,
        countyName: null,
        confidence: 'low',
        reply: '',
        safety: false,
        source: 'fallback',
      }),
    ),
    situation: vi.fn(() => Promise.resolve(analysis())),
    recommend: vi.fn(() =>
      Promise.resolve({ recommendations: [], reply: '', source: 'fallback' as const }),
    ),
    lead: vi.fn((request: LeadRequest) =>
      Promise.resolve({
        ok: true as const,
        contacted: request.memberIds.map((id) => cards.find((c) => c.id === id)?.name ?? id),
        safety: false,
      }),
    ),
    tracy: vi.fn(() => Promise.resolve({ ok: true as const, safety: false })),
    events: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
  return api as FakeApi;
}

export interface Harness {
  api: FakeApi;
  controller: ChatController;
  events: Array<{ type: string; data: unknown }>;
  state: () => ChatState;
  /** What the assistant and the visitor have said so far, as text. */
  texts: () => string[];
  settle: () => Promise<void>;
}

export function harness(
  overrides: Partial<Api> = {},
  links: Partial<PublicConfig['links']> = {},
): Harness {
  const api = fakeApi(overrides);
  const events: Harness['events'] = [];
  const tracker: Tracker = {
    track: (type, data) => void events.push({ type, data }),
    flush() {},
    dispose() {},
  };
  const controller = new ChatController({
    api,
    config: { ...config, links: { ...config.links, ...links } },
    sessionId: '11111111-2222-4333-8444-555555555555',
    site: 'divorceamicably',
    mode: 'inline',
    tracker,
    typingDelayMs: 0,
  });
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let round = 0; round < 200 && controller.getState().busy; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  return {
    api,
    controller,
    events,
    state: controller.getState,
    texts: () =>
      controller
        .getState()
        .items.map((item) => (item.kind === 'safety' ? '[safety card]' : item.text)),
    settle,
  };
}

/** Starts the chat and moves on to a step by the main path, answering with real options. */
export async function advanceTo(
  h: Harness,
  step: 'location' | 'county' | 'stage' | 'situation' | 'category' | 'results' | 'contact',
): Promise<void> {
  const steps: Array<[string, string]> = [
    ['welcome', 'divorce'],
    ['location', 'GA'],
    ['county', '13121'],
    ['stage', 'ready'],
    ['situation', 'skip'],
    ['category', 'attorney'],
  ];
  h.controller.start();
  await h.settle();
  const order = [
    'welcome',
    'location',
    'county',
    'stage',
    'situation',
    'category',
    'results',
    'contact',
  ];
  for (const [from, id] of steps) {
    if (order.indexOf(from) >= order.indexOf(step)) break;
    h.controller.choose(id);
    await h.settle();
  }
  if (step === 'contact') {
    h.controller.toggleSelected('p1');
    h.controller.toggleSelected('g1');
    h.controller.contactSelected();
    await h.settle();
  }
}

export const validContact: ContactValues = {
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.org',
  phone: '',
  preferredContact: 'email',
  message: 'We want to keep this civil.',
  consent: true,
  trap: '',
};

export const failure = (status = 0, code = 'network') => Promise.reject(new ApiError(status, code));
