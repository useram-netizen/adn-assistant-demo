import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { copy } from '../../server/src/config/copy.ts';
import { PRIVACY_URL, WIDGET_ORIGIN } from './env.ts';

const welcome = copy.steps.welcome;

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

test('meets WCAG 2.2 AA automated checks, before and after answering', async ({ page }) => {
  await page.goto('/widget?site=divorceamicably');
  await expect(page.getByText(welcome.message)).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole('button', { name: welcome.optionProfessional }).click();
  await expect(page.getByText(copy.steps.proInfo.message)).toBeVisible();
  await expectNoAxeViolations(page);
});

test('works with the keyboard and moves focus to the new input', async ({ page, browserName }) => {
  // Safari moves between buttons and links with Option+Tab (plain Tab only visits form fields).
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await page.goto('/widget?site=divorceamicably');
  await expect(page.getByText(welcome.message)).toBeVisible();
  // Nothing takes focus when the page loads (it would steal focus from the host page).
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

  await page.keyboard.press(tab);
  await expect(page.getByRole('button', { name: welcome.optionDivorce })).toBeFocused();
  await page.keyboard.press(tab);
  await expect(page.getByRole('button', { name: welcome.optionProfessional })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('link', { name: new RegExp(copy.steps.proInfo.joinButton) }),
  ).toBeFocused();

  await page.getByRole('button', { name: copy.widget.back }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: welcome.optionDivorce })).toBeFocused();
});

test('replies to typed text with the fallback message and the buttons', async ({ page }) => {
  await page.goto('/widget?site=divorceamicably');
  const box = page.getByRole('textbox', { name: copy.widget.inputLabel });
  await expect(page.getByText(welcome.message)).toBeVisible();
  await box.fill('What is the weather like?');
  await box.press('Enter');
  await expect(page.getByText('What is the weather like?')).toBeVisible();
  await expect(page.getByText(copy.fallback.didNotCatch)).toBeVisible();
  await expect(page.getByRole('button', { name: welcome.optionDivorce })).toBeVisible();
  await expect(box).toBeFocused();
});

test('shows the footer on every screen', async ({ page }) => {
  await page.goto('/widget?site=divorceamicably');
  // The footer sits inside <main>, so it is not a landmark of its own.
  const footer = page.locator('footer');
  await expect(footer).toContainText(
    `${copy.footer.automated} · ${copy.footer.disclaimer} · ${copy.footer.privacy}`,
  );
  await expect(footer.getByRole('link', { name: /Privacy/ })).toHaveAttribute('href', PRIVACY_URL);
  await page.getByRole('button', { name: welcome.optionDivorce }).click();
  await expect(page.getByText(copy.steps.location.message)).toBeVisible();
  await expect(footer).toBeVisible();
});

for (const width of [320, 375, 600, 800]) {
  test(`has no horizontal scrolling at ${width} px wide`, async ({ page }) => {
    await page.goto(`/embed-test?mode=inline&width=${width}`);
    const widget = page.locator('#adn-assistant iframe').contentFrame();
    await widget.getByRole('button', { name: welcome.optionDivorce }).click();
    await expect(widget.getByText(copy.steps.location.message)).toBeVisible();

    const result = await widget.locator('body').evaluate(() => {
      const root = document.documentElement;
      const log = document.querySelector('.adn-log')!;
      const tooWide = Array.from(document.querySelectorAll('body *'))
        .filter((el) => el.getBoundingClientRect().right > root.clientWidth + 0.5)
        .map((el) => el.className || el.tagName);
      return {
        width: root.clientWidth,
        pageOverflow: root.scrollWidth - root.clientWidth,
        logOverflow: log.scrollWidth - log.clientWidth,
        tooWide,
      };
    });
    expect(result.width).toBeLessThanOrEqual(width);
    expect(result).toMatchObject({ pageOverflow: 0, logOverflow: 0, tooWide: [] });
  });
}

test('keeps no cookies or storage (spec rule 4)', async ({ page, context }) => {
  await page.goto('/embed-test?mode=inline');
  const widget = page.locator('#adn-assistant iframe').contentFrame();
  await widget.getByRole('button', { name: welcome.optionDivorce }).click();
  await expect(widget.getByText(copy.steps.location.message)).toBeVisible();

  expect(await context.cookies([WIDGET_ORIGIN])).toEqual([]);
  const stored = await widget
    .locator('body')
    .evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }));
  expect(stored).toEqual({ local: 0, session: 0 });
});

test('still works when the browser blocks cookies and storage in iframes', async ({ page }) => {
  await page.addInitScript(() => {
    const blocked = () => {
      throw new DOMException('Blocked in third-party iframes', 'SecurityError');
    };
    Object.defineProperty(window, 'localStorage', { get: blocked });
    Object.defineProperty(window, 'sessionStorage', { get: blocked });
    Object.defineProperty(Document.prototype, 'cookie', { get: blocked, set: blocked });
  });
  await page.goto('/embed-test?mode=inline');
  const widget = page.locator('#adn-assistant iframe').contentFrame();
  await widget.getByRole('button', { name: welcome.optionProfessional }).click();
  await expect(widget.getByText(copy.steps.proInfo.message)).toBeVisible();
});

test('sends the embedding headers', async ({ request }) => {
  const res = await request.get(`${WIDGET_ORIGIN}/widget?site=divorceamicably&mode=inline`);
  expect(res.ok()).toBe(true);
  const headers = res.headers();
  expect(headers['content-security-policy']).toContain(
    "frame-ancestors 'self' http://localhost:* http://127.0.0.1:*",
  );
  expect(headers['x-frame-options']).toBeUndefined();

  const script = await request.get(`${WIDGET_ORIGIN}/embed.js`);
  expect((await script.body()).byteLength).toBeLessThan(5 * 1024);
  expect(script.headers()['cross-origin-resource-policy']).toBe('cross-origin');
});

/** Walks the widget page to the results for Georgia, Fulton County, divorce attorneys (35 cards). */
async function toResults(page: Page) {
  await page.goto('/widget?site=divorceamicably');
  await page.getByRole('button', { name: welcome.optionDivorce }).click();
  const state = page.getByRole('combobox', { name: 'Your state' });
  await state.fill('Geor');
  await page.getByRole('option', { name: 'Georgia', exact: true }).click();
  await page.getByRole('combobox', { name: 'Your county' }).fill('fulton');
  await page.getByRole('option', { name: 'Fulton County', exact: true }).click();
  await page.getByRole('button', { name: copy.steps.stage.options.ready }).click();
  await page.getByRole('button', { name: copy.steps.situation.skip }).click();
  await page.getByRole('button', { name: 'Divorce attorney' }).click();
  await expect(page.locator('.adn-card').first()).toBeVisible();
}

test.describe('the widget page and its conversation (UX review)', () => {
  test('only the conversation scrolls: the widget page itself never does', async ({ page }) => {
    await toResults(page);
    const sizes = await page.evaluate(() => ({
      scroll: document.documentElement.scrollHeight,
      client: document.documentElement.clientHeight,
    }));
    // Screen-reader-only text lies low in the list: it must not stretch the page.
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1);
  });

  test('a state can be typed as its postal code: "GA" is Georgia and "TX" is Texas', async ({
    page,
  }) => {
    await page.goto('/widget?site=divorceamicably');
    await page.getByRole('button', { name: welcome.optionDivorce }).click();
    const states = page.getByRole('combobox', { name: 'Your state' });
    await states.fill('GA');
    await expect(page.getByRole('option').first()).toHaveText('Georgia');
    await states.press('Enter');
    await expect(page.getByText('Which county in Georgia do you live in?')).toBeVisible();

    await page.getByRole('button', { name: copy.widget.startOver }).click();
    await page.getByRole('button', { name: welcome.optionDivorce }).click();
    await page.getByRole('combobox', { name: 'Your state' }).fill('tx');
    await page.getByRole('combobox', { name: 'Your state' }).press('Enter');
    await expect(page.getByText('Which county in Texas do you live in?')).toBeVisible();
  });

  test('the county list opens at the top, with the highlighted option in view', async ({
    page,
  }) => {
    await page.goto('/widget?site=divorceamicably');
    await page.getByRole('button', { name: welcome.optionDivorce }).click();
    await page.getByRole('combobox', { name: 'Your state' }).fill('Texas');
    await page.getByRole('option', { name: 'Texas', exact: true }).click();
    await page.getByRole('combobox', { name: 'Your county' }).click();
    await expect(page.getByRole('option')).toHaveCount(254);

    const inView = () =>
      page.evaluate(() => {
        const list = document.querySelector('.adn-combo-list')!;
        const active = list.querySelector('[data-active="true"]')!;
        const l = list.getBoundingClientRect();
        const a = active.getBoundingClientRect();
        return {
          scrollTop: list.scrollTop,
          visible: a.top >= l.top - 1 && a.bottom <= l.bottom + 1,
        };
      });
    expect(await inView()).toEqual({ scrollTop: 0, visible: true });
    for (let i = 0; i < 15; i += 1) await page.keyboard.press('ArrowDown');
    expect((await inView()).visible).toBe(true);
    // The highlight is an outline as well as a tint (a tint alone is too faint to count).
    expect(
      await page.evaluate(
        () =>
          getComputedStyle(document.querySelector('.adn-combo-option[data-active="true"]')!)
            .outlineStyle,
      ),
    ).toBe('solid');
  });

  test('on a short or zoomed-in screen the contact button scrolls with the list, and every Select can be reached', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 256 });
    await toResults(page);
    expect(
      await page.evaluate(
        () => getComputedStyle(document.querySelector('.adn-contact-bar')!).position,
      ),
    ).toBe('static');
    const reached = await page.evaluate(() => {
      const log = document.querySelector<HTMLElement>('.adn-log')!;
      log.style.scrollBehavior = 'auto';
      const buttons = [...document.querySelectorAll<HTMLElement>('.adn-select')];
      let count = 0;
      for (const button of buttons) {
        let found = false;
        for (let y = 0; y <= log.scrollHeight && !found; y += 20) {
          log.scrollTop = y;
          const r = button.getBoundingClientRect();
          const l = log.getBoundingClientRect();
          if (r.top >= l.top && r.bottom <= l.bottom) {
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            found = hit === button || button.contains(hit);
          }
        }
        if (found) count += 1;
      }
      return { buttons: buttons.length, count };
    });
    expect(reached.buttons).toBe(6);
    expect(reached.count).toBe(6);
  });

  test('scrolling carries on to the host page in an inline embed, but stays in the bubble’s panel', async ({
    page,
  }) => {
    const logOverscroll = () =>
      page.evaluate(
        () => getComputedStyle(document.querySelector('.adn-log')!).overscrollBehaviorY,
      );
    await page.goto('/widget?site=divorceamicably&mode=inline');
    await expect(page.getByText(welcome.message)).toBeVisible();
    expect(await logOverscroll()).toBe('auto');
    await page.goto('/widget?site=divorceamicably&mode=bubble');
    await expect(page.getByText(welcome.message)).toBeVisible();
    expect(await logOverscroll()).toBe('contain');
  });

  test('"Show more" moves the focus to the first card it added', async ({ page }) => {
    await toResults(page);
    await page.getByRole('button', { name: copy.steps.results.showMore }).click();
    const focus = await page.evaluate(() => {
      const card = document.activeElement?.closest('.adn-card');
      const cards = [...document.querySelectorAll('.adn-card')];
      return { tag: document.activeElement?.tagName, index: card ? cards.indexOf(card) : -1 };
    });
    expect(focus).toEqual({ tag: 'BUTTON', index: 6 });
  });

  test('the text box has the focus where typing is the answer (a city or ZIP code)', async ({
    page,
  }) => {
    await page.goto('/widget?site=divorceamicably');
    await page.getByRole('button', { name: welcome.optionDivorce }).click();
    await page.getByRole('combobox', { name: 'Your state' }).fill('Geor');
    await page.getByRole('option', { name: 'Georgia', exact: true }).click();
    await page.getByRole('button', { name: copy.steps.county.notSure }).click();
    await expect(page.getByText(copy.steps.countyHelp.message)).toBeVisible();
    await expect(page.getByRole('textbox', { name: copy.widget.inputLabel })).toBeFocused();
  });

  test('has one main landmark, and the cards’ names are headings under the title', async ({
    page,
  }) => {
    await toResults(page);
    expect(
      await page.evaluate(() => ({
        main: document.querySelectorAll('main').length,
        h1: document.querySelectorAll('h1').length,
        h3: document.querySelectorAll('h3').length,
        cardNames: document.querySelectorAll('.adn-card h2').length,
      })),
    ).toEqual({ main: 1, h1: 1, h3: 0, cardNames: 6 });
    await expectNoAxeViolations(page);
  });
});
