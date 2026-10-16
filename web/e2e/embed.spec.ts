import { expect, test, type Locator, type Page } from '@playwright/test';
import { copy } from '../../server/src/config/copy.ts';
import { BLOCKED_HOST_ORIGIN, JOIN_URL, WIDGET_ORIGIN } from './env.ts';

const welcome = copy.steps.welcome;

function inlineFrame(page: Page): Locator {
  return page.locator('#adn-assistant iframe');
}

/** The inline iframe's height, and how much the conversation inside it overflows. */
async function measureInline(page: Page) {
  const height = await inlineFrame(page).evaluate((frame) => frame.getBoundingClientRect().height);
  const overflow = await inlineFrame(page)
    .contentFrame()
    .locator('.adn-log')
    .evaluate((log) => log.scrollHeight - log.clientHeight);
  return { height, overflow };
}

test.describe('inline embed (the default)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/embed-test?mode=inline');
  });

  test('loads the widget from PUBLIC_BASE_URL, on another origin than the page', async ({
    page,
  }) => {
    await expect(inlineFrame(page)).toHaveAttribute(
      'src',
      `${WIDGET_ORIGIN}/widget?site=divorceamicably&mode=inline`,
    );
    await expect(inlineFrame(page)).toHaveAttribute('title', copy.embed.frameTitle);
    expect(new URL(page.url()).origin).not.toBe(WIDGET_ORIGIN);
    await expect(inlineFrame(page).contentFrame().getByText(welcome.message)).toBeVisible();
  });

  test('main path: welcome, then each button leads to its second message', async ({ page }) => {
    const widget = inlineFrame(page).contentFrame();
    await expect(widget.getByText(welcome.message)).toBeVisible();

    await widget.getByRole('button', { name: welcome.optionDivorce }).click();
    await expect(widget.getByText(copy.steps.location.message)).toBeVisible();

    await widget.getByRole('button', { name: copy.widget.back }).click();
    await widget.getByRole('button', { name: welcome.optionProfessional }).click();
    await expect(widget.getByText(copy.steps.proInfo.message)).toBeVisible();
    await expect(
      widget.getByRole('link', { name: new RegExp(copy.steps.proInfo.joinButton) }),
    ).toHaveAttribute('href', JOIN_URL);

    await widget.getByRole('button', { name: copy.widget.startOver }).click();
    await expect(widget.getByRole('button', { name: welcome.optionDivorce })).toBeVisible();
    await expect(widget.getByText(copy.steps.proInfo.message)).toHaveCount(0);
  });

  test('the iframe height follows the conversation (adn:resize)', async ({ page }) => {
    const widget = inlineFrame(page).contentFrame();
    await expect(widget.getByRole('button', { name: welcome.optionDivorce })).toBeVisible();
    // The iframe settles at the welcome step's height: nothing is cut off.
    await expect.poll(async () => (await measureInline(page)).overflow).toBeLessThanOrEqual(1);
    const atWelcome = await measureInline(page);

    await widget.getByRole('button', { name: welcome.optionProfessional }).click();
    await expect(widget.getByText(copy.steps.proInfo.message)).toBeVisible();
    await expect
      .poll(async () => (await measureInline(page)).height)
      .toBeGreaterThan(atWelcome.height);

    const viewport = page.viewportSize()!;
    const after = await measureInline(page);
    expect(after.height).toBeLessThanOrEqual(viewport.height);
    if (after.height < viewport.height - 24) expect(after.overflow).toBeLessThanOrEqual(1);
  });

  test('keeps the newest message on screen while the visitor uses it', async ({ page }) => {
    const widget = inlineFrame(page).contentFrame();
    await widget.getByRole('button', { name: welcome.optionProfessional }).click();
    const link = widget.getByRole('link', { name: new RegExp(copy.steps.proInfo.joinButton) });
    await expect(link).toBeVisible();
    await expect(link).toBeInViewport();
  });

  test('ignores resize messages that do not come from its own iframe', async ({ page }) => {
    await expect(inlineFrame(page).contentFrame().getByText(welcome.message)).toBeVisible();
    await expect.poll(async () => (await measureInline(page)).overflow).toBeLessThanOrEqual(1);
    const before = await measureInline(page);

    // From the host page itself (wrong origin).
    await page.evaluate(() => window.postMessage({ type: 'adn:resize', height: 1500 }, '*'));
    await page.waitForTimeout(250);
    expect((await measureInline(page)).height).toBe(before.height);
  });
});

test('ignores resize messages from another frame on the widget origin', async ({ page }) => {
  await page.goto('/embed-test?mode=all');
  const inline = inlineFrame(page);
  await expect(inline.contentFrame().getByText(welcome.message)).toBeVisible();
  const fallback = page.locator('#fallback iframe').contentFrame();
  await expect(fallback.getByText(welcome.message)).toBeVisible();
  await expect.poll(async () => (await measureInline(page)).overflow).toBeLessThanOrEqual(1);
  const before = await measureInline(page);

  // The right origin, but sent by the fallback iframe rather than the inline one.
  await fallback
    .locator('body')
    .evaluate(() => window.parent.postMessage({ type: 'adn:resize', height: 1500 }, '*'));
  await page.waitForTimeout(250);
  expect((await measureInline(page)).height).toBe(before.height);
});

test.describe('bubble embed', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/embed-test?mode=bubble');
  });

  test('opens a panel at the bottom right (full screen on phones) and closes again', async ({
    page,
  }) => {
    const bubble = page.getByRole('button', { name: copy.embed.bubbleLabel });
    const panel = page.getByRole('dialog', { name: copy.embed.frameTitle });
    await expect(bubble).toBeVisible();
    await expect(panel).toBeHidden();
    // The widget only loads once the visitor opens the panel.
    await expect(page.locator('#adn-panel iframe')).toHaveCount(0);

    await bubble.click();
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    const viewport = page.viewportSize()!;
    if (viewport.width <= 480) {
      expect(box).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });
    } else {
      expect(box.width).toBe(400);
      expect(box.height).toBe(Math.min(640, viewport.height - 108));
      expect(box.x + box.width).toBe(viewport.width - 20);
    }
    await expect(page.getByRole('button', { name: copy.embed.closeLabel })).toBeFocused();

    const widget = page.locator('#adn-panel iframe').contentFrame();
    await widget.getByRole('button', { name: welcome.optionDivorce }).click();
    await expect(widget.getByText(copy.steps.location.message)).toBeVisible();

    await page.getByRole('button', { name: copy.embed.closeLabel }).click();
    await expect(panel).toBeHidden();
    await expect(bubble).toBeFocused();

    // Reopening keeps the conversation.
    await bubble.click();
    await expect(widget.getByText(copy.steps.location.message)).toBeVisible();
  });

  test('closes with Esc, on the host page and inside the widget', async ({ page }) => {
    const bubble = page.getByRole('button', { name: copy.embed.bubbleLabel });
    const panel = page.getByRole('dialog', { name: copy.embed.frameTitle });

    // Focus is on the panel's close button (host page).
    await bubble.click();
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(bubble).toBeFocused();

    // Focus inside the widget: Esc reaches embed.js as an adn:close message.
    await bubble.click();
    const widget = page.locator('#adn-panel iframe').contentFrame();
    await widget.getByRole('button', { name: welcome.optionDivorce }).focus();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(bubble).toBeFocused();
  });
});

test('fallback iframe (if a page editor strips scripts) shows the assistant', async ({ page }) => {
  await page.goto('/embed-test?mode=fallback');
  const widget = page.locator('#fallback iframe').contentFrame();
  await expect(widget.getByText(welcome.message)).toBeVisible();
  await widget.getByRole('button', { name: welcome.optionProfessional }).click();
  await expect(widget.getByText(copy.steps.proInfo.message)).toBeVisible();
});

test('/embed-test shows only the chatbot by default', async ({ page }) => {
  await page.goto('/embed-test');
  const widget = inlineFrame(page).contentFrame();
  await expect(widget.getByText(welcome.message)).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.getByRole('button', { name: copy.embed.bubbleLabel })).toHaveCount(0);
  await expect(page.locator('h1, h2, nav, pre, a')).toHaveCount(0);
  // The chatbot fits the screen, with no horizontal scrolling on the page.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  const box = await inlineFrame(page).boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.y + box.height <= viewport.height).toBe(true);
  await widget.getByRole('button', { name: welcome.optionDivorce }).click();
  await expect(widget.getByText(copy.steps.location.message)).toBeVisible();
});

test('/embed-test?mode=all shows the inline, bubble and fallback embeds together', async ({
  page,
}) => {
  await page.goto('/embed-test?mode=all');
  await expect(inlineFrame(page).contentFrame().getByText(welcome.message)).toBeVisible();
  await expect(page.getByRole('button', { name: copy.embed.bubbleLabel })).toBeVisible();
  await expect(
    page.locator('#fallback iframe').contentFrame().getByText(welcome.message),
  ).toBeVisible();
});

test('sites outside ALLOWED_EMBED_ORIGINS cannot frame the widget', async ({ page, request }) => {
  const reachable = await request
    .get(`${BLOCKED_HOST_ORIGIN}/api/health`)
    .then((res) => res.ok())
    .catch(() => false);
  test.skip(!reachable, 'IPv6 loopback is not available on this machine');

  await page.goto(`${BLOCKED_HOST_ORIGIN}/embed-test?mode=inline`);
  await expect(inlineFrame(page)).toHaveCount(1);
  await page.waitForTimeout(1500);
  await expect(inlineFrame(page).contentFrame().getByText(welcome.message)).toHaveCount(0);
});
