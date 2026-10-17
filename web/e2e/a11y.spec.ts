import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { copy } from '../../server/src/config/copy.ts';

const welcome = copy.steps.welcome;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** WCAG 2.2 AA: automated checks on the page as it is now. Reports each problem with where it is. */
async function accessible(page: Page, screen: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const found = violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? '?'}): ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
  );
  expect(found, `accessibility problems on: ${screen}`).toEqual([]);
}

async function pick(page: Page, label: string, typed: string, option: string) {
  await page.getByRole('combobox', { name: label }).fill(typed);
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe('accessibility (WCAG 2.2 AA, automated)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/widget?site=divorceamicably');
    await expect(page.getByText(welcome.message)).toBeVisible();
  });

  test('the conversation screens', async ({ page }) => {
    // Eleven axe checks on one walk through the whole conversation: slow on a busy machine.
    test.slow();
    await accessible(page, 'welcome');

    await page.getByRole('button', { name: welcome.optionDivorce }).click();
    const states = page.getByRole('combobox', { name: 'Your state' });
    await expect(states).toBeVisible();
    await accessible(page, 'state step');
    await states.click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await accessible(page, 'state dropdown open');

    await page.getByRole('option', { name: 'Georgia', exact: true }).click();
    await pick(page, 'Your county', 'fulton', 'Fulton County');
    await expect(page.getByText(copy.steps.stage.message)).toBeVisible();
    await accessible(page, 'stage step');

    await page.getByRole('button', { name: copy.steps.stage.options.ready }).click();
    await expect(page.getByText(copy.steps.situation.message)).toBeVisible();
    await accessible(page, 'situation step');

    await page.getByRole('button', { name: copy.steps.situation.skip }).click();
    await expect(page.getByText(copy.steps.category.message)).toBeVisible();
    await accessible(page, 'category step');

    await page.getByRole('button', { name: 'Divorce attorney' }).click();
    await expect(page.locator('.adn-card').first()).toBeVisible();
    await accessible(page, 'results');
    await page.locator('.adn-select').first().click();
    await accessible(page, 'results with a professional selected');

    await page.getByRole('button', { name: 'Contact selected (1)' }).click();
    await expect(page.getByLabel('First name')).toBeVisible();
    await accessible(page, 'contact form');
    await page.getByRole('button', { name: copy.form.submit }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await accessible(page, 'contact form with errors');

    await page.getByLabel('First name').fill('Jane');
    await page.getByLabel('Last name').fill('Doe');
    await page.locator('input[type=email]').fill('a11y.check@example.org');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: copy.form.submit }).click();
    await expect(page.getByText(/Done! Your request went to/)).toBeVisible();
    await accessible(page, 'done screen');
  });

  test('no match, and the Tracy form', async ({ page }) => {
    await page.getByRole('button', { name: welcome.optionDivorce }).click();
    await pick(page, 'Your state', 'wyom', 'Wyoming');
    await pick(page, 'Your county', 'teton', 'Teton County');
    await page.getByRole('button', { name: copy.steps.stage.options.exploring }).click();
    await page.getByRole('button', { name: copy.steps.situation.skip }).click();
    await page.getByRole('button', { name: 'Divorce attorney' }).click();
    await expect(page.getByText("We don't have a divorce attorney listed")).toBeVisible();
    await accessible(page, 'no match');
    await page.getByRole('button', { name: copy.steps.noMatch.emailTracy }).click();
    await expect(page.getByLabel('First name')).toBeVisible();
    await accessible(page, 'Tracy form');
  });

  test('the safety card, "Did you mean…?" and the end screens', async ({ page }) => {
    await page
      .getByRole('textbox', { name: copy.widget.inputLabel })
      .fill("My husband hits me and I'm scared to leave");
    await page.getByRole('textbox', { name: copy.widget.inputLabel }).press('Enter');
    await expect(page.getByRole('complementary', { name: copy.safety.title })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Your state' })).toBeVisible();
    await accessible(page, 'safety card');

    await page.getByRole('textbox', { name: copy.widget.inputLabel }).fill('I live in Atlanta');
    await page.getByRole('textbox', { name: copy.widget.inputLabel }).press('Enter');
    await expect(page.getByText('Did you mean Georgia?')).toBeVisible();
    await accessible(page, 'did you mean');

    await page.getByRole('button', { name: 'Start over' }).click();
    await page.getByRole('button', { name: welcome.optionProfessional }).click();
    await expect(
      page.getByRole('link', { name: new RegExp(copy.steps.proInfo.joinButton) }),
    ).toBeVisible();
    await accessible(page, 'professional branch');
  });
});

test.describe('keyboard', () => {
  test('the state and county can be chosen with the keyboard alone', async ({ page, hasTouch }) => {
    // On a touch screen the widget doesn't open the keyboard by itself, so focus stays put.
    test.skip(hasTouch, 'no automatic focus into a text box on touch screens');
    await page.goto('/widget?site=divorceamicably');
    await expect(page.getByText(welcome.message)).toBeVisible();
    // Tab reaches the first button; Enter presses it.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: welcome.optionDivorce })).toBeFocused();
    await page.keyboard.press('Enter');

    // Focus moves to the dropdown. Type, arrow to the option, Enter.
    const state = page.getByRole('combobox', { name: 'Your state' });
    await expect(state).toBeFocused();
    await page.keyboard.type('ge');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Which county in Georgia do you live in?')).toBeVisible();

    const county = page.getByRole('combobox', { name: 'Your county' });
    await expect(county).toBeFocused();
    await page.keyboard.type('cobb');
    await page.keyboard.press('Enter');
    await expect(page.getByText(copy.steps.stage.message)).toBeVisible();
    // Focus is on the first button of the new step, with the focus ring showing.
    const first = page.getByRole('button', { name: copy.steps.stage.options.exploring });
    await expect(first).toBeFocused();
    const outline = await first.evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('Escape closes the dropdown list and nothing else', async ({ page }) => {
    await page.goto('/widget?site=divorceamicably');
    await page.getByRole('button', { name: welcome.optionDivorce }).click();
    const state = page.getByRole('combobox', { name: 'Your state' });
    await state.click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toBeHidden();
    await expect(state).toBeVisible();
    await expect(page.getByText('Which state are you in?')).toBeVisible();
  });

  test('the text box keeps focus while the visitor types, and Enter sends', async ({ page }) => {
    await page.goto('/widget?site=divorceamicably');
    await page.getByRole('button', { name: welcome.optionDivorce }).click();
    await expect(page.getByRole('combobox', { name: 'Your state' })).toBeVisible();
    const box = page.getByRole('textbox', { name: copy.widget.inputLabel });
    await box.fill('blah blah');
    await box.press('Enter');
    await expect(page.getByText(copy.fallback.didNotCatch)).toBeVisible();
    await expect(box).toBeFocused();
    await expect(box).toHaveValue('');
  });
});
