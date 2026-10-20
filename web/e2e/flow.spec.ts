import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type FrameLocator, type Locator, type Page } from '@playwright/test';
import { copy } from '../../server/src/config/copy.ts';
import {
  AI_OFF_HOST_ORIGIN,
  AI_OFF_MAIL_PREVIEW_DIR,
  AI_OFF_STORAGE_DIR,
  MAIL_PREVIEW_DIR,
  STORAGE_DIR,
} from './env.ts';

const welcome = copy.steps.welcome;

interface Chat {
  page: Page;
  widget: FrameLocator;
  /** A button of the current step. */
  button: (name: string | RegExp) => Locator;
  /** Picks from the state or county dropdown by typing, then clicking the option. */
  pick: (label: string, typed: string, option: string) => Promise<void>;
  /** Types in the always-available text box. */
  type: (text: string) => Promise<void>;
  /** The last thing the assistant said. */
  lastBot: () => Locator;
}

/** Opens the chatbot inside /embed-test (the host page, on another origin than the widget). */
async function open(page: Page, origin = ''): Promise<Chat> {
  await page.goto(`${origin}/embed-test`);
  const widget = page.frameLocator('#adn-assistant iframe');
  await expect(widget.getByText(welcome.message)).toBeVisible();
  // The iframe grows to fit the first message; wait for it to settle before the first click.
  await expect
    .poll(async () => {
      const first = await page.locator('#adn-assistant iframe').boundingBox();
      await page.waitForTimeout(200);
      const second = await page.locator('#adn-assistant iframe').boundingBox();
      return first && second && first.height === second.height;
    })
    .toBe(true);
  return {
    page,
    widget,
    button: (name) => widget.getByRole('button', { name }),
    pick: async (label, typed, option) => {
      const box = widget.getByRole('combobox', { name: label });
      await box.fill(typed);
      await widget.getByRole('option', { name: option, exact: true }).click();
    },
    type: async (text) => {
      const box = widget.getByRole('textbox', { name: copy.widget.inputLabel });
      await box.fill(text);
      await box.press('Enter');
    },
    lastBot: () => widget.locator('.adn-msg--bot').last(),
  };
}

/** The main path to a county: divorce → state → county. */
async function toStage(chat: Chat, state: [string, string], county: [string, string]) {
  await chat.button(welcome.optionDivorce).click();
  await chat.pick('Your state', state[1], state[0]);
  await chat.pick('Your county', county[1], county[0]);
  await expect(chat.lastBot()).toContainText(copy.steps.stage.message);
}

async function fillForm(chat: Chat, email = 'jane.doe@example.org') {
  const { widget } = chat;
  await widget.getByLabel('First name').fill('Jane');
  await widget.getByLabel('Last name').fill('Doe');
  await widget.locator('input[type=email]').fill(email);
  const message = widget.getByLabel('Message', { exact: true });
  if (!(await message.inputValue())) await message.fill('Please get in touch.');
  await widget.getByRole('checkbox').check();
}

function files(dir: string, pattern: RegExp): string[] {
  try {
    return readdirSync(dir).filter((name) => pattern.test(name));
  } catch {
    return [];
  }
}

/**
 * The saved email previews of one kind that mention `needle`. Other tests run at the same time
 * and save their own, so a test counts the ones that carry its own address.
 */
function previewsFor(dir: string, kind: RegExp, needle: string): string[] {
  return files(dir, kind).filter((name) => {
    try {
      return readFileSync(join(dir, name), 'utf8').includes(needle);
    } catch {
      return false;
    }
  });
}

interface Lead {
  id: string;
  kind: string;
  contact: { email: string };
  reason: string | null;
}

/** The saved leads (the file logs a lead again when its emails are updated: the last one wins). */
function leads(dir: string): Lead[] {
  try {
    const byId = new Map<string, Lead>();
    for (const line of readFileSync(join(dir, 'leads.jsonl'), 'utf8').split('\n').filter(Boolean)) {
      const lead = JSON.parse(line) as Lead;
      byId.set(lead.id, lead);
    }
    return [...byId.values()];
  } catch {
    return [];
  }
}

test.describe('the main path (AI on)', () => {
  test('welcome to a sent request: Platinum first, 35 results, emails only previewed', async ({
    page,
  }, testInfo) => {
    const chat = await open(page);
    const { widget } = chat;
    const email = `jane.doe+${testInfo.project.name}${Date.now()}@example.org`;

    await toStage(chat, ['Georgia', 'georg'], ['Fulton County', 'fulton']);
    await chat.button(copy.steps.stage.options.ready).click();
    await chat.button(copy.steps.situation.skip).click();
    await chat.button('Divorce attorney').click();
    await expect(
      widget.getByText('Here are divorce attorneys who serve Fulton County, Georgia:'),
    ).toBeVisible();

    // The first six cards are all Platinum (spec: Platinum first).
    const first = widget.locator('.adn-card');
    await expect(first).toHaveCount(6);
    for (const card of await first.all())
      await expect(card).toHaveAttribute('data-tier', 'platinum');
    // Show more, 6 at a time, until all 35 show: 6 Platinum, 10 Gold, 19 Silver.
    while (await widget.getByRole('button', { name: copy.steps.results.showMore }).count()) {
      await widget.getByRole('button', { name: copy.steps.results.showMore }).click();
    }
    await expect(widget.locator('.adn-card')).toHaveCount(35);
    await expect(widget.locator('.adn-card[data-tier=platinum]')).toHaveCount(6);
    await expect(widget.locator('.adn-card[data-tier=gold]')).toHaveCount(10);
    await expect(widget.locator('.adn-card[data-tier=silver]')).toHaveCount(19);
    // Silver gets no tier badge; cards never show the professional's email.
    await expect(
      widget.locator(
        '.adn-card[data-tier=silver] .adn-badge--platinum, .adn-card[data-tier=silver] .adn-badge--gold',
      ),
    ).toHaveCount(0);
    await expect(widget.locator('.adn-card a[href^="mailto:"]')).toHaveCount(0);

    // Pick two; at most five.
    await widget.locator('.adn-select').nth(0).click();
    await widget.locator('.adn-select').nth(1).click();
    await expect(widget.getByRole('button', { name: 'Contact selected (2)' })).toBeEnabled();
    await widget.getByRole('button', { name: 'Contact selected (2)' }).click();

    await expect(widget.getByRole('textbox', { name: copy.widget.inputLabel })).toBeHidden();
    await fillForm(chat, email);
    await widget.getByRole('button', { name: copy.form.submit }).click();
    await expect(
      widget.getByText(/Done! Your request went to .+\. You'll also get a confirmation email\./),
    ).toBeVisible();

    // Nothing was sent: the emails were saved as previews, and the lead was saved.
    await expect.poll(() => previewsFor(MAIL_PREVIEW_DIR, /professional/, email).length).toBe(2);
    await expect
      .poll(() => previewsFor(MAIL_PREVIEW_DIR, /client/, email).length)
      .toBeGreaterThan(0);
    expect(
      leads(STORAGE_DIR).some((lead) => lead.kind === 'pros' && lead.contact.email === email),
    ).toBe(true);
  });

  test('selecting is limited to five professionals', async ({ page }) => {
    const chat = await open(page);
    await toStage(chat, ['Georgia', 'georg'], ['Fulton County', 'fulton']);
    await chat.button(copy.steps.stage.options.exploring).click();
    await chat.button(copy.steps.situation.skip).click();
    await chat.button('Mediator').click();
    await expect(chat.widget.locator('.adn-card').first()).toBeVisible();
    const toggles = chat.widget.locator('.adn-select');
    for (let index = 0; index < 5; index += 1) await toggles.nth(index).click();
    await expect(chat.widget.getByRole('button', { name: 'Contact selected (5)' })).toBeEnabled();
    await expect(chat.widget.getByText(copy.steps.results.maxReached)).toBeVisible();
    await expect(toggles.nth(5)).toBeDisabled();
  });

  test('a financial expert: asks which kind, then searches that kind', async ({ page }) => {
    const chat = await open(page);
    await toStage(chat, ['Georgia', 'georg'], ['Fulton County', 'fulton']);
    await chat.button(copy.steps.stage.options.ready).click();
    await chat.button(copy.steps.situation.skip).click();
    await chat.button('Financial expert (e.g. CDFA)').click();
    await expect(chat.lastBot()).toContainText(copy.steps.subcategory.message);
    await chat.button(copy.subtypes.financial.cdfa).click();
    await expect(chat.widget.locator('.adn-card').first()).toBeVisible();
    await expect(chat.widget.locator('.adn-card-labels').first()).toContainText('CDFA');
  });

  test('Back clears the later answers; Start over begins again', async ({ page }) => {
    const chat = await open(page);
    await toStage(chat, ['Georgia', 'georg'], ['Fulton County', 'fulton']);
    await chat.button(copy.steps.stage.options.ready).click();
    await expect(chat.lastBot()).toContainText(copy.steps.situation.message);
    await chat.widget.getByRole('button', { name: 'Back' }).click();
    await expect(chat.lastBot()).toContainText(copy.steps.stage.message);
    await expect(
      chat.widget.getByText(copy.steps.stage.options.ready, { exact: true }),
    ).toHaveCount(1); // only the button
    await chat.button(copy.steps.stage.options.in_process).click();
    await expect(chat.lastBot()).toContainText(copy.steps.situation.message);

    await chat.widget.getByRole('button', { name: 'Start over' }).click();
    await expect(chat.widget.locator('.adn-msg')).toHaveCount(1);
    await expect(chat.button(welcome.optionDivorce)).toBeVisible();
  });
});

test.describe('the branches', () => {
  test('UK: the UK site', async ({ page }) => {
    const chat = await open(page);
    await chat.button(welcome.optionDivorce).click();
    await expect(chat.widget.getByRole('combobox', { name: 'Your state' })).toBeVisible();
    await chat.button(copy.steps.location.optionUk).click();
    await expect(chat.lastBot()).toContainText(copy.steps.uk.message);
    const link = chat.widget.getByRole('link', { name: new RegExp(copy.steps.uk.button) });
    await expect(link).toHaveAttribute('href', 'https://amicabledivorcenetwork.co.uk/');
    await expect(link).toHaveAttribute('target', '_blank');
  });

  test('professional: a welcome, a link to join, and a way on (Start over)', async ({ page }) => {
    const chat = await open(page);
    await chat.button(welcome.optionProfessional).click();
    await expect(chat.lastBot()).toContainText(copy.steps.proInfo.message);
    await expect(
      chat.widget.getByRole('link', { name: new RegExp(copy.steps.proInfo.joinButton) }),
    ).toHaveAttribute('href', 'https://example.com/join');
    await chat.widget.locator('.adn-options').getByRole('button', { name: 'Start over' }).click();
    await expect(chat.button(welcome.optionDivorce)).toBeVisible();
  });

  test('somewhere else: Email Tracy', async ({ page }) => {
    const chat = await open(page);
    await chat.button(welcome.optionDivorce).click();
    await expect(chat.widget.getByRole('combobox', { name: 'Your state' })).toBeVisible();
    await chat.button(copy.steps.location.optionOutside).click();
    await expect(chat.lastBot()).toContainText(copy.steps.outside.message);
    await chat.button(copy.steps.outside.emailTracy).click();
    await expect(chat.lastBot()).toContainText(copy.steps.tracy.message);
    await fillForm(chat);
    await chat.widget.getByRole('button', { name: copy.form.submitTracy }).click();
    await expect(chat.widget.getByText(copy.steps.done.messageTracy)).toBeVisible();
  });

  test('no match: the Email Tracy form, and the gap is saved', async ({ page }) => {
    const chat = await open(page);
    await toStage(chat, ['Wyoming', 'wyom'], ['Teton County', 'teton']);
    await chat.button(copy.steps.stage.options.exploring).click();
    await chat.button(copy.steps.situation.skip).click();
    await chat.button('Divorce attorney').click();
    await expect(chat.lastBot()).toContainText(
      "We don't have a divorce attorney listed for Teton County yet.",
    );
    await expect(chat.button(copy.steps.noMatch.tryAnother)).toBeVisible();
    await expect(
      chat.widget
        .locator('.adn-options')
        .getByRole('button', { name: copy.steps.noMatch.startOver }),
    ).toBeVisible();

    await chat.button(copy.steps.noMatch.emailTracy).click();
    await expect(chat.widget.getByRole('group', { name: copy.form.preferredTracy })).toBeVisible();
    await fillForm(chat);
    await chat.widget.getByRole('button', { name: copy.form.submitTracy }).click();
    await expect(chat.widget.getByText(copy.steps.done.messageTracy)).toBeVisible();
    await expect.poll(() => files(MAIL_PREVIEW_DIR, /_tracy_/).length).toBeGreaterThan(0);
    const gaps = readFileSync(join(STORAGE_DIR, 'gaps.jsonl'), 'utf8');
    expect(gaps).toContain('"countyFips":"56039"');
    expect(
      leads(STORAGE_DIR).some((lead) => lead.kind === 'tracy' && lead.reason === 'no_match'),
    ).toBe(true);
  });
});

test.describe('Stephen’s tests (2026-10-20)', () => {
  test('"I’m looking for a mediator in the boston area" finds mediators in Suffolk County, Massachusetts', async ({
    page,
  }) => {
    const chat = await open(page);
    await chat.type("I'm looking for a mediator in the boston area");
    await expect(
      chat.widget.getByText('I can help you find a mediator near Boston.'),
    ).toBeVisible();
    await expect(chat.lastBot()).toHaveText(/Are you in Massachusetts\?/);
    await chat.button('Yes').click();
    await expect(chat.lastBot()).toHaveText(/That sounds like Suffolk County\. Is that right\?/);
    await chat.button('Yes').click();
    await expect(chat.lastBot()).toContainText(copy.steps.stage.message);
    await chat.button(copy.steps.stage.options.ready).click();
    await chat.button(copy.steps.situation.skip).click();
    await expect(chat.lastBot()).toHaveText(
      /You mentioned a mediator\. Shall I look for mediators\?/,
    );
    await chat.button('Yes').click();
    await expect(
      chat.widget.getByText('Here are mediators who serve Suffolk County, Massachusetts:'),
    ).toBeVisible();
    await expect(chat.widget.locator('.adn-card').first()).toBeVisible();
  });

  test('"I need a divorce attorney" at the state question is noted, not "I didn’t catch that"', async ({
    page,
  }) => {
    const chat = await open(page);
    await chat.button(welcome.optionDivorce).click();
    await expect(chat.widget.getByRole('combobox', { name: 'Your state' })).toBeVisible();
    await chat.type('I need a divorce attorney');
    await expect(chat.widget.getByText("Got it, I'll look for divorce attorneys.")).toBeVisible();
    await expect(chat.lastBot()).toContainText(copy.steps.location.message);
    await expect(chat.widget.getByText(copy.fallback.didNotCatch)).toHaveCount(0);
  });

  test('a connection that drops for a moment goes unnoticed: the request is tried again', async ({
    page,
  }) => {
    const chat = await open(page);
    let dropped = 0;
    await chat.page.route('**/api/states', async (route) => {
      if (dropped < 2) {
        dropped += 1;
        return route.abort('internetdisconnected');
      }
      return route.continue();
    });
    await chat.button(welcome.optionDivorce).click();
    await expect(chat.widget.getByRole('combobox', { name: 'Your state' })).toBeVisible();
    expect(dropped).toBe(2);
    await expect(chat.widget.getByText(copy.widget.connectionError)).toHaveCount(0);
  });

  test('a connection that stays down says so plainly, and Try again works once it is back', async ({
    page,
  }) => {
    const chat = await open(page);
    await chat.page.route('**/api/states', (route) => route.abort('internetdisconnected'));
    await chat.button(welcome.optionDivorce).click();
    await expect(chat.widget.getByText(copy.widget.connectionError)).toBeVisible();
    await expect(chat.widget.getByText(copy.widget.requestError)).toHaveCount(0);

    // Typed text while it is down: not "I didn't catch that".
    await chat.page.route('**/api/ai/interpret', (route) => route.abort('internetdisconnected'));

    await chat.page.unroute('**/api/states');
    await chat.button(copy.widget.retry).click();
    await expect(chat.widget.getByRole('combobox', { name: 'Your state' })).toBeVisible();
    await chat.type('I live in Atlanta');
    await expect(chat.lastBot()).toContainText(copy.widget.connectionError);
    await expect(chat.widget.getByText(copy.fallback.didNotCatch)).toHaveCount(0);
  });
});

test.describe('typed text (AI on)', () => {
  test('a typed answer asks "Did you mean…?"', async ({ page }) => {
    const chat = await open(page);
    await chat.button(welcome.optionDivorce).click();
    await expect(chat.widget.getByRole('combobox', { name: 'Your state' })).toBeVisible();
    await chat.type('I live in Atlanta');
    await expect(chat.lastBot()).toHaveText(/Did you mean Georgia\?/);
    await expect(chat.button('Yes')).toBeVisible();
    await expect(chat.button('No')).toBeVisible();
    await chat.button('Yes').click();
    await expect(chat.lastBot()).toContainText('Which county in Georgia do you live in?');
  });

  test('"No" shows the options again', async ({ page }) => {
    const chat = await open(page);
    await chat.button(welcome.optionDivorce).click();
    await expect(chat.widget.getByRole('combobox', { name: 'Your state' })).toBeVisible();
    await chat.type('I live in Atlanta');
    await chat.button('No').click();
    await expect(chat.lastBot()).toContainText(copy.fallback.pickInstead);
    await expect(chat.widget.getByRole('combobox', { name: 'Your state' })).toBeVisible();
  });

  test('sharing the situation at the first step is kept, and not asked again', async ({ page }) => {
    const chat = await open(page);
    await chat.type(
      'My husband and I decided to split. We have two kids and want to keep it civil',
    );
    // Understood as "going through a divorce": straight to the state question, no "didn't catch that".
    await expect(chat.widget.getByRole('combobox', { name: 'Your state' })).toBeVisible();
    await expect(chat.widget.getByText(copy.fallback.didNotCatch)).toHaveCount(0);
    await chat.pick('Your state', 'georg', 'Georgia');
    await chat.pick('Your county', 'cobb', 'Cobb County');
    await chat.button(copy.steps.stage.options.ready).click();
    await expect(chat.lastBot()).toContainText(copy.steps.category.message);
    await expect(chat.widget.getByText(copy.steps.situation.message)).toHaveCount(0);
    for (const name of ['Mediator', 'Divorce coach', 'Therapist or counselor']) {
      await expect(chat.button(new RegExp(`^${name}\\s*Suggested`))).toBeVisible();
    }
  });

  test('"We agree on almost everything…" suggests a mediator', async ({ page }) => {
    const chat = await open(page);
    await toStage(chat, ['Georgia', 'georg'], ['Cobb County', 'cobb']);
    await chat.button(copy.steps.stage.options.ready).click();
    await expect(chat.lastBot()).toContainText(copy.steps.situation.message);
    await chat.type('We agree on almost everything, we just need someone to put it in writing');
    await expect(chat.button(/^Mediator\s*Suggested/)).toBeVisible();
    await expect(chat.button(/^Divorce attorney\s*Suggested/)).toBeVisible();
  });

  test('a general question gets a short answer, then the question again', async ({ page }) => {
    const chat = await open(page);
    await toStage(chat, ['Georgia', 'georg'], ['Cobb County', 'cobb']);
    await chat.button(copy.steps.stage.options.ready).click();
    await chat.button(copy.steps.situation.skip).click();
    await expect(chat.lastBot()).toContainText(copy.steps.category.message);
    await chat.type('What does a CDFA do?');
    await expect(chat.widget.getByText(/A CDFA is a financial professional/)).toBeVisible();
    await expect(chat.lastBot()).toContainText(copy.steps.category.message);
  });

  test('a question that asks for advice gets none, and points to an attorney', async ({ page }) => {
    const chat = await open(page);
    await toStage(chat, ['Georgia', 'georg'], ['Cobb County', 'cobb']);
    await chat.button(copy.steps.stage.options.ready).click();
    await chat.button(copy.steps.situation.skip).click();
    await expect(chat.lastBot()).toContainText(copy.steps.category.message);
    await chat.type('Should I ask for full custody?');
    await expect(chat.widget.getByText(/I can’t advise you/)).toBeVisible();
    await expect(chat.widget.getByText(/A divorce attorney can help/)).toBeVisible();
  });

  test('"I\'m not sure" at the county, then "Marietta", finds Cobb County', async ({ page }) => {
    const chat = await open(page);
    await chat.button(welcome.optionDivorce).click();
    await chat.pick('Your state', 'georg', 'Georgia');
    await chat.button(copy.steps.county.notSure).click();
    await expect(chat.lastBot()).toContainText(copy.steps.countyHelp.message);
    await chat.type('Marietta');
    await expect(chat.lastBot()).toContainText('That sounds like Cobb County. Is that right?');
    await chat.button('Yes').click();
    await expect(chat.lastBot()).toContainText(copy.steps.stage.message);
  });

  test('a message about abuse shows the safety card once, then the conversation continues', async ({
    page,
  }) => {
    const chat = await open(page);
    await chat.type("My husband hits me and I'm scared to leave");
    const card = chat.widget.getByRole('complementary', { name: copy.safety.title });
    await expect(card).toBeVisible();
    await expect(card).toContainText("If you're in danger, call 911.");
    await expect(card).toContainText('1-800-799-7233');
    await expect(card).toContainText('988');
    await expect(chat.widget.getByRole('combobox', { name: 'Your state' })).toBeVisible();
    await chat.type('I am afraid for my life');
    // After the card, the assistant says it is there, not "I didn't catch that".
    await expect(chat.widget.getByText(copy.safety.continue)).toBeVisible();
    await expect(chat.widget.getByRole('complementary', { name: copy.safety.title })).toHaveCount(
      1,
    );
  });

  test('"I\'m a mediator, how do I join?" goes to the professional path', async ({ page }) => {
    const chat = await open(page);
    await chat.type("I'm a mediator, how do I join?");
    await expect(chat.lastBot()).toContainText(copy.steps.proInfo.message);
  });

  test('"I\'m in London" asks "Did you mean the UK?", then shows the UK site', async ({ page }) => {
    const chat = await open(page);
    await chat.button(welcome.optionDivorce).click();
    await expect(chat.widget.getByRole('combobox', { name: 'Your state' })).toBeVisible();
    await chat.type("I'm in London");
    await expect(chat.lastBot()).toContainText('Did you mean the UK?');
    await chat.button('Yes').click();
    await expect(
      chat.widget.getByRole('link', { name: new RegExp(copy.steps.uk.button) }),
    ).toBeVisible();
  });
});

test.describe('with the AI off: buttons only (AI_ENABLED=false)', () => {
  test('the whole path works', async ({ page }, testInfo) => {
    const chat = await open(page, AI_OFF_HOST_ORIGIN);
    await toStage(chat, ['Illinois', 'illin'], ['Cook County', 'cook']);
    await chat.button(copy.steps.stage.options.ready).click();
    await chat.button(copy.steps.situation.skip).click();
    await chat.button('Mediator').click();
    await expect(chat.widget.locator('.adn-card').first()).toBeVisible();
    await expect(chat.widget.locator('.adn-card[data-tier=platinum]')).toHaveCount(3);
    await chat.widget.locator('.adn-select').first().click();
    await chat.widget.getByRole('button', { name: 'Contact selected (1)' }).click();
    // The three browser setups share this server, so each looks for its own lead.
    const email = `ai-off-${testInfo.project.name}@example.org`;
    await fillForm(chat, email);
    await chat.widget.getByRole('button', { name: copy.form.submit }).click();
    await expect(chat.widget.getByText(/Done! Your request went to/)).toBeVisible();
    await expect
      .poll(() => leads(AI_OFF_STORAGE_DIR).filter((lead) => lead.contact.email === email).length)
      .toBe(1);
    expect(files(AI_OFF_MAIL_PREVIEW_DIR, /professional/).length).toBeGreaterThan(0);
  });

  test('typed text is answered with the buttons again, not with an error', async ({ page }) => {
    const chat = await open(page, AI_OFF_HOST_ORIGIN);
    await chat.type('What is the weather like?');
    await expect(chat.lastBot()).toContainText(copy.fallback.didNotCatch);
    await expect(chat.button(welcome.optionDivorce)).toBeVisible();
    // A name that is exactly an option still works without the AI.
    await chat.button(welcome.optionDivorce).click();
    await expect(chat.widget.getByRole('combobox', { name: 'Your state' })).toBeVisible();
    await chat.type('Georgia');
    await expect(chat.lastBot()).toContainText('Which county in Georgia do you live in?');
  });

  test('common requests are still understood from keywords, and remembered for later', async ({
    page,
  }) => {
    const chat = await open(page, AI_OFF_HOST_ORIGIN);
    await chat.type('I need a divorce attorney in Atlanta');
    await expect(chat.widget.getByText('I can help you find a divorce attorney.')).toBeVisible();
    await expect(chat.lastBot()).toContainText('Are you in Georgia?');
    await chat.button('Yes').click();
    // Without the AI the city can't be placed in a county: the county question.
    await expect(chat.lastBot()).toContainText('Which county in Georgia do you live in?');
    await chat.pick('Your county', 'fulton', 'Fulton County');
    await chat.button(copy.steps.stage.options.ready).click();
    await chat.button(copy.steps.situation.skip).click();
    await expect(chat.lastBot()).toContainText(
      'You mentioned a divorce attorney. Shall I look for divorce attorneys?',
    );
    await chat.button('Yes').click();
    await expect(
      chat.widget.getByText('Here are divorce attorneys who serve Fulton County, Georgia:'),
    ).toBeVisible();
  });

  test('the situation step says "Thank you for sharing that." and keeps the visitor’s own words for the form', async ({
    page,
  }) => {
    const chat = await open(page, AI_OFF_HOST_ORIGIN);
    await toStage(chat, ['Georgia', 'georg'], ['Cobb County', 'cobb']);
    await chat.button(copy.steps.stage.options.ready).click();
    await expect(chat.lastBot()).toContainText(copy.steps.situation.message);
    await chat.type('We separated in the spring.');
    await expect(chat.widget.getByText(copy.steps.situation.ack)).toBeVisible();
    await chat.button('Mediator').click();
    await chat.widget.locator('.adn-select').first().click();
    await chat.widget.getByRole('button', { name: 'Contact selected (1)' }).click();
    await expect(chat.widget.getByLabel('Message', { exact: true })).toHaveValue(
      "I'm ready to get started. We separated in the spring.",
    );
  });

  test('the safety card still appears (the keyword check does not need the AI)', async ({
    page,
  }) => {
    const chat = await open(page, AI_OFF_HOST_ORIGIN);
    await chat.type("He hits me and I'm scared");
    await expect(chat.widget.getByRole('complementary', { name: copy.safety.title })).toBeVisible();
  });

  test('says the AI is off', async ({ request }) => {
    const res = await request.get(`${AI_OFF_HOST_ORIGIN}/api/health`);
    expect(await res.json()).toMatchObject({ ok: true, ai: 'off', members: 199 });
  });
});

test.describe('layout on every screen', () => {
  test('results and forms fit the width with no horizontal scrolling', async ({ page }) => {
    const chat = await open(page);
    const fits = async () =>
      chat.widget
        .locator('body')
        .evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        );
    await toStage(chat, ['Georgia', 'georg'], ['Fulton County', 'fulton']);
    expect(await fits()).toBe(true);
    await chat.button(copy.steps.stage.options.ready).click();
    await chat.button(copy.steps.situation.skip).click();
    await chat.button('Divorce attorney').click();
    await expect(chat.widget.locator('.adn-card').first()).toBeVisible();
    expect(await fits()).toBe(true);
    await chat.widget.locator('.adn-select').first().click();
    await chat.widget.getByRole('button', { name: 'Contact selected (1)' }).click();
    await expect(chat.widget.getByLabel('First name')).toBeVisible();
    expect(await fits()).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
