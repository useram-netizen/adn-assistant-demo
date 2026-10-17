import { copy, fill } from '@adn/copy';
import { describe, expect, it, vi } from 'vitest';
import { stepOptions } from '../src/flow/options';
import {
  advanceTo,
  analysis,
  cards,
  failure,
  harness,
  option,
  unclear,
  validContact,
} from './support';

describe('the main path', () => {
  it('shows the welcome message first, without taking focus', async () => {
    const h = harness();
    h.controller.start();
    await h.settle();
    expect(h.state().step).toBe('welcome');
    expect(h.texts()).toEqual([copy.steps.welcome.message]);
    expect(h.state().focus).toBe('none');
    expect(h.state().busy).toBe(false);
  });

  it('goes from the welcome to a sent request', async () => {
    const h = harness();
    await advanceTo(h, 'results');
    expect(h.state().step).toBe('results');
    expect(h.api.match).toHaveBeenCalledWith({
      sessionId: '11111111-2222-4333-8444-555555555555',
      site: 'divorceamicably',
      state: 'GA',
      countyFips: '13121',
      category: 'attorney',
      subcategory: null,
    });
    expect(h.texts().at(-1)).toBe(
      'Here are divorce attorneys who serve Fulton County, Georgia:\nSelect up to 5 professionals, then tap Contact selected.',
    );
    expect(h.state().results?.shown).toBe(6);

    h.controller.toggleSelected('p1');
    h.controller.toggleSelected('s2');
    h.controller.contactSelected();
    await h.settle();
    expect(h.state().step).toBe('contact');
    expect(h.state().form?.kind).toBe('pros');
    expect(h.texts().at(-1)).toBe(fill(copy.steps.contact.message, { names: 'Pro p1 and Pro s2' }));

    h.controller.submitForm(validContact);
    await h.settle();
    expect(h.api.lead).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Jane',
        email: 'jane@example.org',
        phone: null,
        state: 'GA',
        countyFips: '13121',
        category: 'attorney',
        subcategory: null,
        stage: 'ready',
        memberIds: ['p1', 's2'],
        website: '',
        consent: true,
      }),
    );
    expect(h.state().step).toBe('done');
    expect(h.texts()).toContain(
      "Done! Your request went to Pro p1 and Pro s2. You'll also get a confirmation email.",
    );
    expect(h.texts().at(-1)).toBe(copy.steps.whatsNext.message);
  });

  it('echoes each answer as the visitor’s message', async () => {
    const h = harness();
    await advanceTo(h, 'stage');
    expect(h.texts()).toEqual([
      copy.steps.welcome.message,
      copy.steps.welcome.optionDivorce,
      copy.steps.location.message,
      'Georgia',
      'Which county in Georgia do you live in?',
      'Fulton County',
      copy.steps.stage.message,
    ]);
  });

  it('asks for a subtype only for financial, coach, therapist and real estate', async () => {
    const h = harness();
    await advanceTo(h, 'category');
    h.controller.choose('financial');
    await h.settle();
    expect(h.state().step).toBe('subcategory');
    expect(stepOptions('subcategory', h.state()).map((o) => o.id)).toEqual([
      'cdfa',
      'planner',
      'forensic',
      'valuation',
      'accountant',
      'insurance',
      'any',
    ]);
    h.controller.choose('cdfa');
    await h.settle();
    expect(h.api.match).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: 'financial', subcategory: 'cdfa' }),
    );

    const mediator = harness();
    await advanceTo(mediator, 'category');
    mediator.controller.choose('mediator');
    await mediator.settle();
    expect(mediator.state().step).toBe('results');
  });

  it('"Any / not sure" searches the whole category', async () => {
    const h = harness();
    await advanceTo(h, 'category');
    h.controller.choose('coach');
    await h.settle();
    h.controller.choose('any');
    await h.settle();
    expect(h.api.match).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: 'coach', subcategory: null }),
    );
  });

  it('"More options" leads to the other kinds of professionals', async () => {
    const h = harness();
    await advanceTo(h, 'category');
    h.controller.choose('more');
    await h.settle();
    expect(h.state().step).toBe('category_more');
    expect(stepOptions('category_more', h.state()).map((o) => o.id)).toEqual([
      'arbitrator',
      'parenting_coordinator',
      'estate_attorney',
      'qdro_attorney',
      'bankruptcy_attorney',
      'paralegal',
    ]);
    h.controller.choose('arbitrator');
    await h.settle();
    expect(h.state().step).toBe('results');
    expect(h.state().answers.category).toBe('arbitrator');
  });

  it('shows the cards 6 at a time and lets the visitor pick at most 5', async () => {
    const h = harness();
    await advanceTo(h, 'results');
    h.controller.showMore();
    expect(h.state().results?.shown).toBe(12);
    for (const id of ['p1', 'p2', 'g1', 'g2', 's1', 's2']) h.controller.toggleSelected(id);
    expect(h.state().results?.selected).toEqual(['p1', 'p2', 'g1', 'g2', 's1']);
    h.controller.toggleSelected('p1');
    expect(h.state().results?.selected).toEqual(['p2', 'g1', 'g2', 's1']);
  });

  it('will not contact nobody', async () => {
    const h = harness();
    await advanceTo(h, 'results');
    h.controller.contactSelected();
    await h.settle();
    expect(h.state().step).toBe('results');
  });

  it('ignores a button picked while the assistant is still typing', async () => {
    const h = harness();
    h.controller.start();
    await h.settle();
    h.controller.choose('divorce');
    h.controller.choose('professional');
    await h.settle();
    expect(h.state().step).toBe('location');
  });
});

describe('the branches', () => {
  it('pro: a welcome and a link to join, ending there', async () => {
    const h = harness();
    h.controller.start();
    await h.settle();
    h.controller.choose('professional');
    await h.settle();
    expect(h.state().step).toBe('pro_info');
    expect(h.texts().at(-1)).toBe(copy.steps.proInfo.message);
    expect(h.events).toContainEqual({ type: 'branch', data: { branch: 'pro' } });
  });

  it('pro with no JOIN_URL set: says no more than it can offer', async () => {
    const h = harness({}, { join: null });
    h.controller.start();
    await h.settle();
    h.controller.choose('professional');
    await h.settle();
    expect(h.texts().at(-1)).toBe(copy.steps.proInfo.messageNoLink);
    expect(h.texts().at(-1)).not.toMatch(/coming soon/i);
  });

  it('UK: the UK site, ending there', async () => {
    const h = harness();
    await advanceTo(h, 'location');
    h.controller.choose('uk');
    await h.settle();
    expect(h.state().step).toBe('uk');
    expect(h.texts().at(-1)).toBe(copy.steps.uk.message);
    expect(h.events).toContainEqual({ type: 'branch', data: { branch: 'uk' } });
  });

  it('somewhere else: Email Tracy opens the Tracy form for a visitor outside the US and UK', async () => {
    const h = harness();
    await advanceTo(h, 'location');
    h.controller.choose('outside');
    await h.settle();
    expect(h.state().step).toBe('outside');
    expect(stepOptions('outside', h.state()).map((o) => o.label)).toEqual(['Email Tracy']);
    h.controller.choose('tracy');
    await h.settle();
    expect(h.state().step).toBe('tracy');
    expect(h.state().form?.kind).toBe('tracy');

    h.controller.submitForm(validContact);
    await h.settle();
    expect(h.api.tracy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'outside', state: null, countyFips: null, category: null }),
    );
    expect(h.state().step).toBe('done');
    expect(h.texts()).toContain(copy.steps.done.messageTracy);
  });

  it('no match: offers Email Tracy, another type, or starting over', async () => {
    const h = harness();
    h.controller.start();
    await h.settle();
    for (const id of ['divorce', 'WY', '56039', 'exploring', 'skip', 'attorney']) {
      h.controller.choose(id);
      await h.settle();
    }
    expect(h.state().step).toBe('no_match');
    expect(h.texts().at(-1)).toBe(
      fill(copy.steps.noMatch.message, {
        categoryWithArticle: 'a divorce attorney',
        county: 'Teton County',
      }),
    );
    expect(stepOptions('no_match', h.state()).map((o) => o.id)).toEqual([
      'tracy',
      'another',
      'restart',
    ]);
    expect(h.events).toContainEqual({
      type: 'no_match',
      data: { category: 'attorney', state: 'WY', countyFips: '56039' },
    });

    h.controller.choose('tracy');
    await h.settle();
    expect(h.state().step).toBe('tracy');
    h.controller.submitForm(validContact);
    await h.settle();
    expect(h.api.tracy).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'no_match',
        state: 'WY',
        countyFips: '56039',
        category: 'attorney',
      }),
    );
  });

  it('no match: "Try another type of professional" returns to the categories', async () => {
    const h = harness();
    h.controller.start();
    await h.settle();
    for (const id of ['divorce', 'WY', '56039', 'exploring', 'skip', 'attorney', 'another']) {
      h.controller.choose(id);
      await h.settle();
    }
    expect(h.state().step).toBe('category');
  });

  it('the last screen suggests other types of professionals for a new search in the same county', async () => {
    const h = harness();
    await advanceTo(h, 'contact');
    h.controller.submitForm(validContact);
    await h.settle();
    expect(stepOptions('done', h.state()).map((o) => o.id)).toEqual([
      'mediator',
      'financial',
      'therapist',
      'restart',
    ]);
    h.controller.choose('mediator');
    await h.settle();
    expect(h.state().step).toBe('results');
    expect(h.api.match).toHaveBeenLastCalledWith(
      expect.objectContaining({
        category: 'mediator',
        state: 'GA',
        countyFips: '13121',
        subcategory: null,
      }),
    );
  });
});

describe('typed text', () => {
  it('"Did you mean…?": Yes accepts the option, No shows the step’s options again', async () => {
    const h = harness({ interpret: vi.fn(() => Promise.resolve(option('GA'))) });
    await advanceTo(h, 'location');
    h.controller.say('I live in Atlanta');
    await h.settle();
    expect(h.texts().slice(-2)).toEqual(['I live in Atlanta', 'Did you mean Georgia?']);
    expect(h.state().confirm).toEqual({ step: 'location', optionId: 'GA', label: 'Georgia' });
    expect(h.state().step).toBe('location');

    h.controller.confirmAnswer(true);
    await h.settle();
    expect(h.state().step).toBe('county');
    expect(h.state().answers.state).toBe('GA');

    const no = harness({ interpret: vi.fn(() => Promise.resolve(option('GA'))) });
    await advanceTo(no, 'location');
    no.controller.say('I live in Atlanta');
    await no.settle();
    no.controller.confirmAnswer(false);
    await no.settle();
    expect(no.texts().slice(-2)).toEqual(['No', copy.fallback.pickInstead]);
    expect(no.state().step).toBe('location');
    expect(no.state().confirm).toBeNull();
  });

  it('sends the step, the text and the state or category the options depend on', async () => {
    const h = harness();
    await advanceTo(h, 'county');
    h.controller.say('Cobb');
    await h.settle();
    expect(h.api.interpret).toHaveBeenCalledWith({
      sessionId: '11111111-2222-4333-8444-555555555555',
      site: 'divorceamicably',
      step: 'county',
      text: 'Cobb',
      state: 'GA',
    });
  });

  it('accepts an exact match straight away, without asking', async () => {
    const h = harness({
      interpret: vi.fn(() => Promise.resolve(option('GA', { source: 'exact' }))),
    });
    await advanceTo(h, 'location');
    h.controller.say('Georgia');
    await h.settle();
    expect(h.state().step).toBe('county');
    expect(h.state().confirm).toBeNull();
  });

  it('at the welcome and the stage, accepts what the AI understood directly', async () => {
    const h = harness({ interpret: vi.fn(() => Promise.resolve(option('divorce'))) });
    h.controller.start();
    await h.settle();
    h.controller.say('my husband and I are splitting up');
    await h.settle();
    expect(h.state().step).toBe('location');
    expect(h.state().confirm).toBeNull();

    const stage = harness();
    await advanceTo(stage, 'stage');
    stage.api.interpret.mockResolvedValueOnce(option('in_process'));
    stage.controller.say('we are already in court');
    await stage.settle();
    expect(stage.state().step).toBe('situation');
    expect(stage.state().answers.stage).toBe('in_process');
  });

  it('shows the AI’s kind reply, then asks the same question again, for a general question', async () => {
    const h = harness({
      interpret: vi.fn(() =>
        Promise.resolve({
          ...unclear,
          kind: 'question' as const,
          reply: 'A CDFA helps with divorce finances.',
          source: 'ai' as const,
        }),
      ),
    });
    await advanceTo(h, 'category');
    h.controller.say('What does a CDFA do?');
    await h.settle();
    expect(h.texts().slice(-3)).toEqual([
      'What does a CDFA do?',
      'A CDFA helps with divorce finances.',
      copy.steps.category.message,
    ]);
    expect(h.state().step).toBe('category');
  });

  it('says it did not catch it, and shows the buttons again, when the text is unclear or the AI is down', async () => {
    const h = harness();
    await advanceTo(h, 'category');
    h.controller.say('blah');
    await h.settle();
    expect(h.texts().at(-1)).toBe(copy.fallback.didNotCatch);
    expect(h.state().step).toBe('category');

    const down = harness({ interpret: vi.fn(() => failure(0, 'network')) });
    await advanceTo(down, 'category');
    down.controller.say('blah');
    await down.settle();
    expect(down.texts().at(-1)).toBe(copy.fallback.didNotCatch);
    expect(down.state().step).toBe('category');
  });

  it('shows the safety card once, then carries on with the conversation', async () => {
    const h = harness({
      interpret: vi.fn(() =>
        Promise.resolve(
          option('divorce', { safety: true, sharesSituation: true, reply: 'I am so sorry.' }),
        ),
      ),
    });
    h.controller.start();
    await h.settle();
    h.controller.say("My husband hits me and I'm scared to leave");
    await h.settle();
    expect(h.texts()).toEqual([
      copy.steps.welcome.message,
      "My husband hits me and I'm scared to leave",
      '[safety card]',
      'I am so sorry.',
      copy.steps.location.message,
    ]);
    expect(h.state().step).toBe('location');
    expect(h.events).toContainEqual({ type: 'safety_shown', data: { trigger: 'ai' } });

    h.controller.say('I am afraid for my life');
    await h.settle();
    expect(h.texts().filter((text) => text === '[safety card]')).toHaveLength(1);
    expect(h.events.filter((event) => event.type === 'safety_shown')).toHaveLength(1);
  });

  it('takes no text at the contact form (the text box is hidden there)', async () => {
    const h = harness();
    await advanceTo(h, 'contact');
    h.controller.say('hello?');
    await h.settle();
    expect(h.api.interpret).not.toHaveBeenCalled();
  });

  it('never sends more than 1,000 characters', async () => {
    const h = harness();
    h.controller.start();
    await h.settle();
    h.controller.say('x'.repeat(1500));
    await h.settle();
    expect(h.api.interpret.mock.calls[0]![0].text).toHaveLength(1000);
  });
});

describe('the visitor’s situation, from any step', () => {
  const situation = 'My husband and I decided to split. We have two kids and want to keep it civil';

  it('keeps text that shares the situation, skips asking for it again, and suggests professionals', async () => {
    const h = harness({
      interpret: vi.fn(() =>
        Promise.resolve(option('divorce', { sharesSituation: true, reply: 'I am sorry.' })),
      ),
    });
    h.controller.start();
    await h.settle();
    h.controller.say(situation);
    await h.settle();
    expect(h.state().step).toBe('location');
    expect(h.state().texts).toEqual([situation]);

    for (const id of ['GA', '13121', 'ready']) {
      h.controller.choose(id);
      await h.settle();
    }
    // The situation step is skipped: straight to the categories, with suggestions.
    expect(h.state().step).toBe('category');
    expect(h.texts().filter((text) => text === copy.steps.situation.message)).toHaveLength(0);
    expect(h.api.situation).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'ready', text: situation }),
    );
    const tagged = stepOptions('category', h.state())
      .filter((o) => o.tag)
      .map((o) => o.id);
    // Tagged in the order of the buttons (mediator, coach, therapist), not the AI's order.
    expect(tagged).toEqual(['mediator', 'coach', 'therapist']);
    expect(stepOptions('category', h.state()).find((o) => o.id === 'mediator')?.tag).toBe(
      'Suggested',
    );
  });

  it('typed at the situation step: acknowledges, then goes to the categories with suggestions', async () => {
    const h = harness({
      situation: vi.fn(() =>
        Promise.resolve(
          analysis({ reply: 'Thank you.', suggestedCategories: ['mediator', 'attorney'] }),
        ),
      ),
    });
    await advanceTo(h, 'situation');
    h.controller.say('We agree on almost everything, we just need someone to put it in writing');
    await h.settle();
    expect(h.texts().slice(-3)).toEqual([
      'We agree on almost everything, we just need someone to put it in writing',
      'Thank you.',
      copy.steps.category.message,
    ]);
    expect(h.state().step).toBe('category');
    expect(
      stepOptions('category', h.state())
        .filter((o) => o.tag)
        .map((o) => o.id),
    ).toEqual(['attorney', 'mediator']);
  });

  it('with the AI down: "Thank you for sharing that.", and the form starts with the visitor’s own words', async () => {
    const h = harness({ situation: vi.fn(() => failure(0, 'network')) });
    await advanceTo(h, 'situation');
    h.controller.say('We split up last month.');
    await h.settle();
    expect(h.texts()).toContain(copy.steps.situation.ack);
    expect(h.state().step).toBe('category');
    h.controller.choose('attorney');
    await h.settle();
    h.controller.toggleSelected('p1');
    h.controller.contactSelected();
    await h.settle();
    expect(h.state().form?.values.message).toBe(
      "I'm ready to get started. We split up last month.",
    );
  });

  it('starts the form with the AI’s neutral summary when there is one', async () => {
    const h = harness();
    await advanceTo(h, 'situation');
    h.controller.say('two kids, keep it civil');
    await h.settle();
    h.controller.choose('attorney');
    await h.settle();
    h.controller.toggleSelected('p1');
    h.controller.contactSelected();
    await h.settle();
    expect(h.state().form?.values.message).toBe(
      'They have two children and want to keep things civil.',
    );
  });

  it('starts the form with what the visitor is looking for when they said nothing else', async () => {
    const h = harness();
    await advanceTo(h, 'contact');
    expect(h.state().form?.values.message).toBe("I'm ready to get started.");
    const h2 = harness();
    h2.controller.start();
    await h2.settle();
    h2.api.interpret.mockResolvedValue(unclear);
    // No stage either: nothing but the search itself.
    for (const id of ['divorce', 'GA', '13121']) {
      h2.controller.choose(id);
      await h2.settle();
    }
    expect(h2.state().form).toBeNull();
  });

  it('skipping the question keeps things as they were', async () => {
    const h = harness();
    await advanceTo(h, 'situation');
    h.controller.choose('skip');
    await h.settle();
    expect(h.state().step).toBe('category');
    expect(h.api.situation).not.toHaveBeenCalled();
    expect(stepOptions('category', h.state()).some((o) => o.tag)).toBe(false);
  });

  it('shares more at the category step: the suggestions follow', async () => {
    const h = harness();
    await advanceTo(h, 'category');
    h.api.interpret.mockResolvedValueOnce({ ...unclear, sharesSituation: true });
    h.controller.say('We have three kids and can’t agree on anything');
    await h.settle();
    expect(h.api.situation).toHaveBeenCalled();
    expect(stepOptions('category', h.state()).some((o) => o.tag)).toBe(true);
  });
});

describe('county help', () => {
  async function toCountyHelp(h: ReturnType<typeof harness>) {
    await advanceTo(h, 'county');
    h.controller.choose('not_sure');
    await h.settle();
  }

  it('asks which city, town or ZIP code, then confirms the county the AI found', async () => {
    const h = harness({
      county: vi.fn(() =>
        Promise.resolve({
          countyFips: '13067',
          countyName: 'Cobb County',
          confidence: 'high' as const,
          reply: '',
          safety: false,
          source: 'ai' as const,
        }),
      ),
    });
    await toCountyHelp(h);
    expect(h.state().step).toBe('county_help');
    expect(h.texts().at(-1)).toBe(copy.steps.countyHelp.message);

    h.controller.say('Marietta');
    await h.settle();
    expect(h.api.county).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'GA', text: 'Marietta' }),
    );
    expect(h.state().step).toBe('county_confirm');
    expect(h.texts().at(-1)).toBe('That sounds like Cobb County. Is that right?');

    h.controller.choose('yes');
    await h.settle();
    expect(h.state().step).toBe('stage');
    expect(h.state().answers).toMatchObject({ countyFips: '13067', countyName: 'Cobb County' });
  });

  it('"No, let me pick" shows the county list', async () => {
    const h = harness({
      county: vi.fn(() =>
        Promise.resolve({
          countyFips: '13067',
          countyName: 'Cobb County',
          confidence: 'low' as const,
          reply: '',
          safety: false,
          source: 'ai' as const,
        }),
      ),
    });
    await toCountyHelp(h);
    h.controller.say('somewhere near Atlanta');
    await h.settle();
    h.controller.choose('no');
    await h.settle();
    expect(h.state().step).toBe('county');
    expect(h.texts().at(-1)).toBe(copy.steps.countyHelp.pick);
  });

  it('shows the county list when no county was found or the AI is down', async () => {
    const h = harness();
    await toCountyHelp(h);
    h.controller.say('Marietta');
    await h.settle();
    expect(h.state().step).toBe('county');
    expect(h.texts().at(-1)).toBe(copy.steps.countyHelp.notFound);

    const down = harness({ county: vi.fn(() => failure(0, 'network')) });
    await toCountyHelp(down);
    down.controller.say('Marietta');
    await down.settle();
    expect(down.state().step).toBe('county');
  });
});

describe('not sure which kind of professional', () => {
  it('without a situation: one line about each kind', async () => {
    const h = harness();
    await advanceTo(h, 'category');
    h.controller.choose('not_sure');
    await h.settle();
    expect(h.state().step).toBe('category_help');
    expect(h.api.recommend).not.toHaveBeenCalled();
    expect(h.texts().at(-1)).toBe(copy.steps.categoryHelp.explain);
    const options = stepOptions('category_help', h.state());
    expect(options).toHaveLength(12);
    expect(options[0]).toMatchObject({
      id: 'attorney',
      description: copy.categoryExplanations.attorney,
    });
  });

  it('with a situation: the AI’s recommendations with a reason each', async () => {
    const h = harness({
      recommend: vi.fn(() =>
        Promise.resolve({
          recommendations: [
            { category: 'mediator' as const, reason: 'Helps you agree together' },
            { category: 'coach' as const, reason: 'Supports your next steps' },
          ],
          reply: 'These could help.',
          source: 'ai' as const,
        }),
      ),
    });
    await advanceTo(h, 'situation');
    h.controller.say('two kids, keep it civil');
    await h.settle();
    h.controller.choose('not_sure');
    await h.settle();
    expect(h.texts().at(-1)).toBe(copy.steps.categoryHelp.recommended);
    expect(stepOptions('category_help', h.state()).map((o) => [o.id, o.description])).toEqual([
      ['mediator', 'Helps you agree together'],
      ['coach', 'Supports your next steps'],
      ['see_all', undefined],
    ]);
    h.controller.choose('mediator');
    await h.settle();
    expect(h.state().step).toBe('results');
  });

  it('falls back to the explanations when the AI gives nothing', async () => {
    const h = harness();
    await advanceTo(h, 'situation');
    h.controller.say('two kids');
    await h.settle();
    h.controller.choose('not_sure');
    await h.settle();
    expect(h.texts().at(-1)).toBe(copy.steps.categoryHelp.explain);
  });
});

describe('Back and Start over', () => {
  it('goes back one step and clears every answer after it', async () => {
    const h = harness();
    await advanceTo(h, 'results');
    h.controller.back();
    expect(h.state().step).toBe('category');
    expect(h.state().answers.category).toBeNull();
    h.controller.back();
    expect(h.state().step).toBe('situation');
    h.controller.back();
    expect(h.state().step).toBe('stage');
    expect(h.state().answers.stage).toBeNull();
    expect(h.state().answers.countyFips).toBe('13121');
    h.controller.back();
    expect(h.state().step).toBe('county');
    expect(h.state().answers.countyFips).toBeNull();
    h.controller.back();
    expect(h.state().step).toBe('location');
    expect(h.state().answers.state).toBeNull();
    // The conversation is the one it was when the step was first shown.
    expect(h.texts()).toEqual([
      copy.steps.welcome.message,
      copy.steps.welcome.optionDivorce,
      copy.steps.location.message,
    ]);
  });

  it('lets the visitor change an answer and carry on from there', async () => {
    const h = harness();
    await advanceTo(h, 'stage');
    h.controller.back();
    expect(h.state().step).toBe('county');
    h.controller.choose('13067');
    await h.settle();
    expect(h.state().answers.countyName).toBe('Cobb County');
    expect(h.state().step).toBe('stage');
  });

  it('returns to the results with the picks still selected', async () => {
    const h = harness();
    await advanceTo(h, 'contact');
    h.controller.back();
    expect(h.state().step).toBe('results');
    expect(h.state().results?.selected).toEqual(['p1', 'g1']);
  });

  it('keeps what was typed in the contact form when going back and forward again', async () => {
    const h = harness();
    await advanceTo(h, 'contact');
    h.controller.saveDraft({ ...validContact, firstName: 'Typed' });
    h.controller.back();
    h.controller.contactSelected();
    await h.settle();
    // Going forward again starts a new form; going back to it (from done) would restore the draft.
    expect(h.state().step).toBe('contact');
  });

  it('forgets the situation that was shared after the step being returned to', async () => {
    const h = harness();
    await advanceTo(h, 'situation');
    h.controller.say('two kids, keep it civil');
    await h.settle();
    expect(h.state().texts).toHaveLength(1);
    h.controller.back();
    expect(h.state().step).toBe('situation');
    expect(h.state().texts).toEqual([]);
    expect(h.state().analysis).toBeNull();
  });

  it('keeps the safety card the visitor has seen, wherever Back goes', async () => {
    const h = harness();
    await advanceTo(h, 'stage');
    h.api.interpret.mockResolvedValueOnce({ ...unclear, safety: true });
    h.controller.say('he threatens me');
    await h.settle();
    h.controller.back();
    expect(h.texts()).toContain('[safety card]');
    expect(h.state().safetyShown).toBe(true);
  });

  it('Back at the very start does nothing, and the buttons say so', async () => {
    const h = harness();
    h.controller.start();
    await h.settle();
    expect(h.controller.canGoBack).toBe(false);
    h.controller.back();
    await h.settle();
    expect(h.state().step).toBe('welcome');
  });

  it('Start over clears the answers but not the fact that the safety card was shown', async () => {
    const h = harness();
    await advanceTo(h, 'stage');
    h.api.interpret.mockResolvedValueOnce({ ...unclear, safety: true });
    h.controller.say('he threatens me');
    await h.settle();
    h.controller.restart();
    await h.settle();
    expect(h.state().step).toBe('welcome');
    expect(h.state().answers.state).toBeNull();
    expect(h.state().history).toEqual([]);
    expect(h.texts()).toEqual([copy.steps.welcome.message]);
    expect(h.state().safetyShown).toBe(true);
  });

  it('drops a late answer from the server when the visitor has already moved on', async () => {
    let release: (value: unknown) => void = () => undefined;
    const h = harness({
      match: vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      ) as never,
    });
    await advanceTo(h, 'category');
    h.controller.choose('attorney');
    await vi.waitFor(() => expect(h.api.match).toHaveBeenCalled());
    h.controller.back();
    expect(h.state().step).toBe('category');
    release({ results: [], total: 0, noMatch: true, counts: { platinum: 0, gold: 0, silver: 0 } });
    await h.settle();
    expect(h.state().step).toBe('category');
    expect(h.state().results).toBeNull();
  });
});

describe('when something goes wrong', () => {
  it('a failed search shows a friendly message and Try again, which repeats it', async () => {
    const h = harness();
    await advanceTo(h, 'category');
    h.api.match.mockImplementationOnce(() => failure(500, 'server_error'));
    h.controller.choose('attorney');
    await h.settle();
    expect(h.texts().at(-1)).toBe(copy.widget.requestError);
    expect(h.state().step).toBeNull();
    expect(h.state().retry).not.toBeNull();

    h.controller.retryLast();
    await h.settle();
    expect(h.state().step).toBe('results');
    expect(h.state().retry).toBeNull();
  });

  it('says so in its own words when the visitor is going too fast (429)', async () => {
    const h = harness();
    await advanceTo(h, 'category');
    h.api.match.mockImplementationOnce(() => failure(429, 'rate_limited'));
    h.controller.choose('attorney');
    await h.settle();
    expect(h.texts().at(-1)).toBe(copy.widget.rateLimited);
  });

  it('a failed state list is never a dead end', async () => {
    const h = harness();
    h.api.states.mockImplementationOnce(() => failure());
    h.controller.start();
    await h.settle();
    h.controller.choose('divorce');
    await h.settle();
    expect(h.state().retry).not.toBeNull();
    h.controller.retryLast();
    await h.settle();
    expect(h.state().step).toBe('location');
    expect(h.state().lists.states).toHaveLength(2);
  });

  it('a failed send keeps the form, with a message and the typed words', async () => {
    const h = harness();
    await advanceTo(h, 'contact');
    h.api.lead.mockImplementationOnce(() => failure(500, 'server_error'));
    h.controller.submitForm(validContact);
    await h.settle();
    expect(h.state().step).toBe('contact');
    expect(h.state().form).toMatchObject({ submitting: false, error: copy.form.submitError });
    expect(h.state().form?.values.firstName).toBe('Jane');

    h.controller.submitForm(validContact);
    await h.settle();
    expect(h.state().step).toBe('done');
  });

  it('does not send the form twice while it is sending', async () => {
    let release: (value: unknown) => void = () => undefined;
    const h = harness({
      lead: vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      ) as never,
    });
    await advanceTo(h, 'contact');
    h.controller.submitForm(validContact);
    h.controller.submitForm(validContact);
    expect(h.api.lead).toHaveBeenCalledTimes(1);
    release({ ok: true, contacted: ['Pro p1'], safety: false });
    await h.settle();
    expect(h.state().step).toBe('done');
  });

  it('shows the safety card on the last screen if the message looked like a safety concern', async () => {
    const h = harness({
      lead: vi.fn(() =>
        Promise.resolve({ ok: true as const, contacted: ['Pro p1'], safety: true }),
      ),
    });
    await advanceTo(h, 'contact');
    h.controller.submitForm(validContact);
    await h.settle();
    expect(h.texts()).toContain('[safety card]');
  });
});

describe('usage events', () => {
  it('records option values and counts, never anything the visitor typed', async () => {
    const h = harness({
      interpret: vi.fn(() => Promise.resolve(option('GA', { source: 'exact' }))),
    });
    await advanceTo(h, 'location');
    h.controller.say('Georgia, where my husband hits me');
    await h.settle();
    for (const id of ['13121', 'ready', 'skip', 'attorney']) {
      h.controller.choose(id);
      await h.settle();
    }
    h.controller.toggleSelected('p1');
    h.controller.contactSelected();
    await h.settle();
    const types = h.events.map((event) => event.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'session_started',
        'step_viewed',
        'answer',
        'results_shown',
        'pros_selected',
      ]),
    );
    expect(h.events).toContainEqual({ type: 'answer', data: { step: 'location', value: 'GA' } });
    expect(h.events).toContainEqual({
      type: 'results_shown',
      data: {
        platinum: 2,
        gold: 2,
        silver: 4,
        total: cards.length,
        category: 'attorney',
        state: 'GA',
      },
    });
    const everything = JSON.stringify(h.events);
    expect(everything).not.toContain('husband');
    expect(everything).not.toContain('hits');
  });
});

describe('the contact details', () => {
  it('only the form sends them, and only to the lead and Tracy routes (never to the AI routes)', async () => {
    const h = harness();
    await advanceTo(h, 'contact');
    h.controller.submitForm({
      ...validContact,
      email: 'secret@example.org',
      firstName: 'Secretname',
    });
    await h.settle();
    const aiCalls: unknown[] = [
      ...h.api.interpret.mock.calls,
      ...h.api.county.mock.calls,
      ...h.api.situation.mock.calls,
      ...h.api.recommend.mock.calls,
    ];
    expect(JSON.stringify(aiCalls)).not.toMatch(/secret@example\.org|Secretname/);
    expect(JSON.stringify(h.events)).not.toMatch(/secret@example\.org|Secretname/);
    expect(h.texts().join(' ')).not.toMatch(/secret@example\.org|Secretname/);
  });

  it('passes the honeypot field on as "website"', async () => {
    const h = harness();
    await advanceTo(h, 'contact');
    h.controller.submitForm({ ...validContact, trap: 'http://spam.example' });
    await h.settle();
    expect(h.api.lead).toHaveBeenCalledWith(
      expect.objectContaining({ website: 'http://spam.example' }),
    );
  });

  it('sends the phone number only when given, and trims everything', async () => {
    const h = harness();
    await advanceTo(h, 'contact');
    h.controller.submitForm({
      ...validContact,
      phone: ' 404 555 0100 ',
      preferredContact: 'phone',
      firstName: ' Jane ',
    });
    await h.settle();
    expect(h.api.lead).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '404 555 0100',
        preferredContact: 'phone',
        firstName: 'Jane',
      }),
    );
  });
});
