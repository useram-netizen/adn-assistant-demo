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
  await box.fill('I need a mediator');
  await box.press('Enter');
  await expect(page.getByText('I need a mediator')).toBeVisible();
  await expect(page.getByText(copy.fallback.didNotCatch)).toBeVisible();
  await expect(page.getByRole('button', { name: welcome.optionDivorce })).toBeVisible();
  await expect(box).toBeFocused();
});

test('shows the footer on every screen', async ({ page }) => {
  await page.goto('/widget?site=divorceamicably');
  const footer = page.getByRole('contentinfo');
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
