import { copy } from '@adn/copy';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { App } from '../src/App';
import { Combobox } from '../src/chat/Combobox';
import { filterOptions } from '../src/chat/filterOptions';
import { ContactForm } from '../src/chat/ContactForm';
import { emptyContact, validateContact } from '../src/flow/form';
import type { FormState } from '../src/flow/types';
import { ApiError } from '../src/lib/api';
import { noTracker } from '../src/lib/events';
import { fakeApi, option, unclear, validContact } from './support';

const states = [
  { value: 'GA', label: 'Georgia' },
  { value: 'GU', label: 'Guam' },
  { value: 'NM', label: 'New Mexico' },
  { value: 'ND', label: 'North Dakota' },
];
const counties = [
  { value: '35013', label: 'Doña Ana County' },
  { value: '17039', label: 'De Witt County' },
  { value: '13161', label: 'Jeff Davis County' },
];

function renderCombobox(options = states, onSelect = vi.fn()) {
  render(
    <Combobox
      label="Your state"
      placeholder="Start typing…"
      noResults="No matching state"
      options={options}
      onSelect={onSelect}
    />,
  );
  return { onSelect, input: screen.getByRole('combobox', { name: 'Your state' }) };
}

describe('Combobox', () => {
  it('is an ARIA combobox with a listbox of options, closed until used', () => {
    const { input } = renderCombobox();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('filters as the visitor types, putting names that start with the text first', async () => {
    const user = userEvent.setup();
    const { input } = renderCombobox();
    await user.type(input, 'n');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'New Mexico',
      'North Dakota',
    ]);
    await user.type(input, 'o');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['North Dakota']);
  });

  it('ignores case, accents and punctuation', () => {
    expect(filterOptions(counties, 'dona').map((o) => o.label)).toEqual(['Doña Ana County']);
    expect(filterOptions(counties, 'DEWITT').map((o) => o.label)).toEqual(['De Witt County']);
    expect(filterOptions(counties, 'jeff-davis').map((o) => o.label)).toEqual([
      'Jeff Davis County',
    ]);
    expect(filterOptions(counties, '')).toHaveLength(3);
  });

  it('matches a state’s postal code first: "GA" is Georgia, not Michigan', async () => {
    const states = [
      { value: 'GA', label: 'Georgia' },
      { value: 'MI', label: 'Michigan' },
      { value: 'NV', label: 'Nevada' },
      { value: 'PA', label: 'Pennsylvania' },
      { value: 'TX', label: 'Texas' },
      { value: 'VA', label: 'Virginia' },
    ];
    expect(filterOptions(states, 'GA').map((o) => o.label)).toEqual(['Georgia', 'Michigan']);
    expect(filterOptions(states, 'va').map((o) => o.label)).toEqual([
      'Virginia',
      'Nevada',
      'Pennsylvania',
    ]);
    expect(filterOptions(states, ' T.X ').map((o) => o.label)).toEqual(['Texas']);

    const user = userEvent.setup();
    const { input, onSelect } = renderCombobox(states);
    await user.type(input, 'GA');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('GA');
  });

  it('picks with the arrow keys and Enter', async () => {
    const user = userEvent.setup();
    const { input, onSelect } = renderCombobox();
    await user.type(input, 'g');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith('GU');
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps aria-activedescendant on the highlighted option', async () => {
    const user = userEvent.setup();
    const { input } = renderCombobox();
    await user.type(input, 'g');
    const [first, second] = screen.getAllByRole('option');
    expect(input).toHaveAttribute('aria-activedescendant', first!.id);
    expect(first).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', second!.id);
    await user.keyboard('{ArrowUp}');
    expect(input).toHaveAttribute('aria-activedescendant', first!.id);
  });

  it('opens the whole list with the down arrow', async () => {
    const user = userEvent.setup();
    const { input } = renderCombobox();
    await user.click(input);
    await user.keyboard('{Escape}{ArrowDown}');
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });

  it('picks with the mouse', async () => {
    const user = userEvent.setup();
    const { input, onSelect } = renderCombobox();
    await user.click(input);
    await user.click(screen.getByRole('option', { name: 'New Mexico' }));
    expect(onSelect).toHaveBeenCalledWith('NM');
  });

  it('Escape closes the list only: the key is handled, so a bubble panel stays open', async () => {
    const user = userEvent.setup();
    const { input } = renderCombobox();
    const seen: boolean[] = [];
    const listener = (event: KeyboardEvent) => void seen.push(event.defaultPrevented);
    window.addEventListener('keydown', listener);
    await user.type(input, 'g');
    await user.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    // With the list open, Escape was handled here (defaultPrevented) before it reached the window.
    expect(seen.at(-1)).toBe(true);
    // With the list closed, Escape is left alone (the bubble panel may close).
    await user.keyboard('{Escape}');
    expect(seen.at(-1)).toBe(false);
    window.removeEventListener('keydown', listener);
  });

  it('says so when nothing matches', async () => {
    const user = userEvent.setup();
    const { input, onSelect } = renderCombobox();
    await user.type(input, 'zzz');
    expect(screen.getByText('No matching state')).toBeInTheDocument();
    expect(screen.queryByRole('option')).toBeNull();
    await user.keyboard('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('copes with a long list, such as the 254 counties of Texas', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 254 }, (_, index) => ({
      value: String(index),
      label: `County ${index}`,
    }));
    const { input, onSelect } = renderCombobox(many);
    await user.click(input);
    expect(screen.getAllByRole('option')).toHaveLength(254);
    await user.type(input, '253');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('253');
  });
});

describe('the contact form', () => {
  const baseForm: FormState = {
    kind: 'pros',
    values: emptyContact('A starting message.'),
    submitting: false,
    error: null,
  };

  function renderForm(
    overrides: Partial<FormState> = {},
    privacyUrl: string | null = 'https://example.com/privacy',
  ) {
    const onSubmit = vi.fn();
    const onDraft = vi.fn();
    render(
      <ContactForm
        form={{ ...baseForm, ...overrides }}
        privacyUrl={privacyUrl}
        onDraft={onDraft}
        onSubmit={onSubmit}
        onPrivacyClick={() => undefined}
      />,
    );
    return { onSubmit, onDraft };
  }

  it('has every field of the spec, with the message pre-filled and editable', () => {
    renderForm();
    for (const label of ['First name', 'Last name', 'Phone (optional)', 'Message']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Email', { selector: 'input[type=email]' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: copy.form.preferred })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Email' })).toBeChecked();
    expect(screen.getByLabelText('Message')).toHaveValue('A starting message.');
    expect(
      screen.getByRole('checkbox', {
        name: /I agree to share these details with the professionals I selected/,
      }),
    ).not.toBeChecked();
    expect(screen.getByRole('link', { name: /Privacy policy/ })).toHaveAttribute(
      'href',
      'https://example.com/privacy',
    );
  });

  it('limits the message to 1,500 characters and counts what is left', () => {
    renderForm();
    expect(screen.getByLabelText('Message')).toHaveAttribute('maxlength', '1500');
    expect(screen.getByText('(1481)')).toBeInTheDocument();
  });

  it('has a hidden trap field: out of sight, out of the tab order and away from screen readers', () => {
    renderForm();
    const trap = document.querySelector<HTMLInputElement>('input[name="website"]')!;
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(trap).toHaveAttribute('tabindex', '-1');
    expect(trap).toHaveAttribute('autocomplete', 'off');
    expect(trap).toHaveValue('');
  });

  it('shows what is missing, next to the fields, and moves focus to the first one', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm({ values: emptyContact('') });
    await user.click(screen.getByRole('button', { name: copy.form.submit }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(copy.form.errors.summary);
    const first = screen.getByLabelText('First name');
    expect(first).toHaveAttribute('aria-invalid', 'true');
    expect(first).toHaveFocus();
    expect(first.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(first.getAttribute('aria-describedby')!)).toHaveTextContent(
      copy.form.errors.required,
    );
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('marks the fields the server did not accept, and takes the visitor to the first', () => {
    const { rerender } = render(
      <ContactForm
        form={{ ...baseForm, values: { ...validContact, email: 'jane@example.com' } }}
        privacyUrl={null}
        onDraft={() => undefined}
        onSubmit={() => undefined}
        onPrivacyClick={() => undefined}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(
      <ContactForm
        form={{
          ...baseForm,
          values: { ...validContact, email: 'jane@example.com' },
          serverFields: ['message', 'email', 'memberIds'],
        }}
        privacyUrl={null}
        onDraft={() => undefined}
        onSubmit={() => undefined}
        onPrivacyClick={() => undefined}
      />,
    );
    const email = screen.getByLabelText('Email', { selector: 'input[type=email]' });
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveFocus();
    expect(document.getElementById(email.getAttribute('aria-describedby')!)).toHaveTextContent(
      copy.form.errors.email,
    );
    expect(screen.getByLabelText('Message')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent(copy.form.errors.summary);
  });

  it('agrees with the server about what an email address is', () => {
    const addresses = [
      'jane@example.org',
      'jane.doe+adn@example.co.uk',
      "o'brien@example.com",
      'john..doe@gmail.com',
      'john@example.com.',
      '.john@example.com',
      'john.@example.com',
      'josé@example.com',
      'jane@localhost',
      'jane@exa_mple.com',
      'jane@-example.com',
      'jane@example.c',
      'jane doe@example.com',
      'jane@@example.com',
      'a@b.co',
    ];
    for (const address of addresses) {
      const server = z.email().safeParse(address).success;
      const widget = validateContact({ ...validContact, email: address }).email === undefined;
      expect(widget, address).toBe(server);
    }
  });

  it('checks the email, and asks for a phone number if the visitor wants to be phoned', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText('First name'), 'Jane');
    await user.type(screen.getByLabelText('Last name'), 'Doe');
    await user.type(
      screen.getByLabelText('Email', { selector: 'input[type=email]' }),
      'not-an-email',
    );
    await user.click(screen.getByRole('radio', { name: 'Phone' }));
    await user.click(screen.getByRole('button', { name: copy.form.submit }));
    expect(screen.getByText(copy.form.errors.email)).toBeInTheDocument();
    expect(screen.getByText(copy.form.errors.phoneNeeded)).toBeInTheDocument();
  });

  it('sends the values when everything is right, and keeps the draft as the visitor types', async () => {
    const user = userEvent.setup();
    const { onSubmit, onDraft } = renderForm({ values: { ...validContact, consent: false } });
    await user.click(screen.getByRole('checkbox'));
    expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ consent: true }));
    await user.click(screen.getByRole('button', { name: copy.form.submit }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Jane', email: 'jane@example.org', consent: true }),
    );
  });

  it('shows "Sending…" and cannot be sent twice', () => {
    renderForm({ values: validContact, submitting: true });
    expect(screen.getByRole('button', { name: copy.form.sending })).toBeDisabled();
  });

  it('shows a failed send with a Try again button', () => {
    renderForm({ values: validContact, error: copy.form.submitError });
    expect(screen.getByRole('alert')).toHaveTextContent(copy.form.submitError);
    expect(screen.getByRole('button', { name: copy.widget.retry })).toBeEnabled();
  });

  it('uses Tracy’s wording in the Tracy form', () => {
    renderForm({ kind: 'tracy' });
    expect(screen.getByRole('group', { name: copy.form.preferredTracy })).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /share these details with Tracy/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.form.submitTracy })).toBeInTheDocument();
  });

  it('leaves out the privacy link while PRIVACY_URL is not set', () => {
    renderForm({}, null);
    expect(screen.queryByRole('link', { name: /Privacy policy/ })).toBeNull();
  });

  it('validates like the server does', () => {
    expect(validateContact(validContact)).toEqual({});
    expect(Object.keys(validateContact(emptyContact('')))).toEqual([
      'firstName',
      'lastName',
      'email',
      'message',
      'consent',
    ]);
    expect(validateContact({ ...validContact, phone: 'call me' }).phone).toBe(
      copy.form.errors.phone,
    );
    expect(validateContact({ ...validContact, phone: '12345' }).phone).toBe(copy.form.errors.phone);
    expect(validateContact({ ...validContact, phone: '+1 (404) 555-0100' }).phone).toBeUndefined();
    expect(validateContact({ ...validContact, message: 'x'.repeat(1501) }).message).toBeDefined();
    expect(validateContact({ ...validContact, firstName: 'x'.repeat(81) }).firstName).toBeDefined();
  });
});

describe('the whole widget', () => {
  const embed = { site: 'divorceamicably', mode: 'standalone', framed: false } as const;

  function renderApp(api = fakeApi()) {
    const user = userEvent.setup();
    const view = render(<App embed={embed} typingDelayMs={0} api={api} tracker={noTracker} />);
    return { user, api, ...view };
  }

  const button = (name: string | RegExp) => screen.findByRole('button', { name });

  it('shows the welcome with its two buttons, a text box, Back and Start over, and the footer', async () => {
    renderApp();
    expect(await button(copy.steps.welcome.optionDivorce)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: copy.steps.welcome.optionProfessional }),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: copy.widget.inputLabel })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start over' })).toBeDisabled();
    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent(
      'Automated assistant · General information only, not legal advice · Privacy',
    );
    expect(within(footer).getByRole('link', { name: /Privacy/ })).toHaveAttribute(
      'href',
      'https://example.com/privacy',
    );
  });

  it('never takes focus when it loads', async () => {
    renderApp();
    await button(copy.steps.welcome.optionDivorce);
    expect(document.body).toHaveFocus();
  });

  it('announces only the conversation, not the buttons or the visitor’s own words', async () => {
    const { user } = renderApp();
    await user.click(await button(copy.steps.welcome.optionDivorce));
    await screen.findByRole('combobox', { name: 'Your state' });
    const log = screen.getByRole('log', { name: copy.widget.conversationLabel });
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(within(log).queryAllByRole('button')).toHaveLength(0);
    expect(
      within(log).getByText(copy.steps.welcome.optionDivorce).closest('[aria-live]'),
    ).toHaveAttribute('aria-live', 'off');
  });

  it('goes from the welcome to the results: state, county, stage, skip, category', async () => {
    const { user, api } = renderApp();
    await user.click(await button(copy.steps.welcome.optionDivorce));
    const state = await screen.findByRole('combobox', { name: 'Your state' });
    await user.type(state, 'georg');
    await user.click(screen.getByRole('option', { name: 'Georgia' }));
    const county = await screen.findByRole('combobox', { name: 'Your county' });
    await user.type(county, 'fult');
    await user.click(screen.getByRole('option', { name: 'Fulton County' }));
    await user.click(await button(copy.steps.stage.options.ready));
    await user.click(await button('Skip'));
    await user.click(await button('Divorce attorney'));
    expect(
      await screen.findByText(/Here are divorce attorneys who serve Fulton County, Georgia:/),
    ).toBeInTheDocument();
    expect(api.match).toHaveBeenCalledOnce();
    const cardsList = screen.getByRole('list', { name: /Here are divorce attorneys/ });
    expect(cardsList.children).toHaveLength(6);
    expect(within(cardsList).getAllByText('Platinum Member')).toHaveLength(2);
    expect(within(cardsList).getAllByText('Gold Member')).toHaveLength(2);
  });

  it('selects professionals with toggle buttons, then contacts them with the form', async () => {
    const { user, api } = renderApp();
    await user.click(await button(copy.steps.welcome.optionDivorce));
    await user.type(await screen.findByRole('combobox', { name: 'Your state' }), 'georgia{Enter}');
    await user.type(await screen.findByRole('combobox', { name: 'Your county' }), 'fulton{Enter}');
    await user.click(await button(copy.steps.stage.options.ready));
    await user.click(await button('Skip'));
    await user.click(await button('Divorce attorney'));
    await screen.findByRole('list', { name: /Here are divorce attorneys/ });

    expect(screen.getByRole('button', { name: 'Contact selected (0)' })).toBeDisabled();
    const toggle = screen.getByRole('button', { name: 'Select Pro p1' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Selected Pro p1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Select Pro g1' }));
    await user.click(screen.getByRole('button', { name: 'Contact selected (2)' }));

    await user.type(await screen.findByLabelText('First name'), 'Jane');
    await user.type(screen.getByLabelText('Last name'), 'Doe');
    await user.type(
      screen.getByLabelText('Email', { selector: 'input[type=email]' }),
      'jane@example.org',
    );
    await user.click(screen.getByRole('checkbox'));
    // The text box is hidden while the form shows (spec); Back and Start over stay.
    expect(screen.queryByRole('textbox', { name: copy.widget.inputLabel })).toBeNull();
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: copy.form.submit }));

    expect(
      await screen.findByText(/Done! Your request went to Pro p1 and Pro g1\./),
    ).toBeInTheDocument();
    expect(api.lead).toHaveBeenCalledWith(
      expect.objectContaining({ memberIds: ['p1', 'g1'], email: 'jane@example.org' }),
    );
  });

  it('answers typed text with "Did you mean…?" and Yes / No buttons', async () => {
    const api = fakeApi({ interpret: vi.fn(() => Promise.resolve(option('GA'))) });
    const { user } = renderApp(api);
    await user.click(await button(copy.steps.welcome.optionDivorce));
    await screen.findByRole('combobox', { name: 'Your state' });
    await user.type(
      screen.getByRole('textbox', { name: copy.widget.inputLabel }),
      'I live in Atlanta{Enter}',
    );
    expect(await screen.findByText('Did you mean Georgia?')).toBeInTheDocument();
    await user.click(await button('Yes'));
    expect(await screen.findByRole('combobox', { name: 'Your county' })).toBeInTheDocument();
  });

  it('keeps focus in the text box while the visitor types, and moves it to a new input after a click', async () => {
    const { user } = renderApp();
    await user.click(await button(copy.steps.welcome.optionDivorce));
    await screen.findByRole('combobox', { name: 'Your state' });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Your state' })).toHaveFocus());
    const box = screen.getByRole('textbox', { name: copy.widget.inputLabel });
    await user.type(box, 'blah{Enter}');
    await screen.findByText(copy.fallback.didNotCatch);
    await waitFor(() => expect(box).toHaveFocus());
  });

  it('shows the safety card, with phone links, when the server says so', async () => {
    const api = fakeApi({
      interpret: vi.fn(() => Promise.resolve({ ...unclear, safety: true, source: 'ai' as const })),
    });
    const { user } = renderApp(api);
    await button(copy.steps.welcome.optionDivorce);
    await user.type(
      screen.getByRole('textbox', { name: copy.widget.inputLabel }),
      'He hits me{Enter}',
    );
    const card = await screen.findByRole('complementary', { name: copy.safety.title });
    expect(card).toHaveTextContent(
      "If you're in danger, call 911. National Domestic Violence Hotline: 1-800-799-7233, or text START to 88788. 988 Suicide & Crisis Lifeline: call or text 988.",
    );
    expect(within(card).getByRole('link', { name: 'Call 911' })).toHaveAttribute('href', 'tel:911');
    expect(within(card).getByRole('link', { name: /Hotline/ })).toHaveAttribute(
      'href',
      'tel:18007997233',
    );
  });

  it('Back returns to the earlier question and Start over to the welcome', async () => {
    const { user } = renderApp();
    await user.click(await button(copy.steps.welcome.optionDivorce));
    await screen.findByRole('combobox', { name: 'Your state' });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await button(copy.steps.welcome.optionDivorce)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: copy.steps.welcome.optionDivorce }));
    await screen.findByRole('combobox', { name: 'Your state' });
    await user.click(screen.getByRole('button', { name: 'Start over' }));
    expect(await button(copy.steps.welcome.optionProfessional)).toBeInTheDocument();
  });

  it('the professional branch links to JOIN_URL in a new tab', async () => {
    const { user } = renderApp();
    await user.click(await button(copy.steps.welcome.optionProfessional));
    const link = await screen.findByRole('link', {
      name: new RegExp(copy.steps.proInfo.joinButton),
    });
    expect(link).toHaveAttribute('href', 'https://example.com/join');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows a friendly message and Try again when the settings do not load', async () => {
    const config = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, 'network'))
      .mockResolvedValue(fakeApi().config());
    const { user } = renderApp(fakeApi({ config }));
    expect(await screen.findByText(copy.widget.loadError)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: copy.widget.retry });
    await waitFor(() => expect(retry).toHaveFocus());
    await user.click(retry);
    expect(await button(copy.steps.welcome.optionDivorce)).toBeInTheDocument();
  });

  it('shows Try again, never a dead end, when a search fails', async () => {
    const api = fakeApi();
    api.match.mockRejectedValueOnce(new ApiError(500, 'server_error'));
    const { user } = renderApp(api);
    await user.click(await button(copy.steps.welcome.optionDivorce));
    await user.type(await screen.findByRole('combobox', { name: 'Your state' }), 'georgia{Enter}');
    await user.type(await screen.findByRole('combobox', { name: 'Your county' }), 'fulton{Enter}');
    await user.click(await button(copy.steps.stage.options.ready));
    await user.click(await button('Skip'));
    await user.click(await button('Divorce attorney'));
    expect(await screen.findByText(copy.widget.requestError)).toBeInTheDocument();
    await user.click(await button(copy.widget.retry));
    expect(await screen.findByText(/Here are divorce attorneys/)).toBeInTheDocument();
  });

  it('uses no cookies and no browser storage (spec rule 4)', async () => {
    const storageCalls = vi.fn();
    const originals = {
      local: Object.getOwnPropertyDescriptor(window, 'localStorage'),
      session: Object.getOwnPropertyDescriptor(window, 'sessionStorage'),
    };
    for (const name of ['localStorage', 'sessionStorage'] as const) {
      Object.defineProperty(window, name, {
        configurable: true,
        get: () => {
          storageCalls(name);
          throw new Error('blocked');
        },
      });
    }
    const cookie = vi.spyOn(document, 'cookie', 'set');
    try {
      const { user } = renderApp();
      await user.click(await button(copy.steps.welcome.optionDivorce));
      await screen.findByRole('combobox', { name: 'Your state' });
      await user.type(
        screen.getByRole('textbox', { name: copy.widget.inputLabel }),
        'hello{Enter}',
      );
      await screen.findByText(copy.fallback.didNotCatch);
      expect(storageCalls).not.toHaveBeenCalled();
      expect(cookie).not.toHaveBeenCalled();
    } finally {
      if (originals.local) Object.defineProperty(window, 'localStorage', originals.local);
      if (originals.session) Object.defineProperty(window, 'sessionStorage', originals.session);
    }
  });

  it('sends its calls without cookies', async () => {
    const calls: Array<RequestInit | undefined> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        calls.push(init);
        return Promise.resolve(
          new Response(JSON.stringify({ links: { privacy: null }, features: {} }), { status: 200 }),
        );
      }),
    );
    render(<App embed={embed} typingDelayMs={0} tracker={noTracker} />);
    await button(copy.steps.welcome.optionDivorce);
    expect(calls.length).toBeGreaterThan(0);
    for (const init of calls) expect(init?.credentials).toBe('omit');
  });
});
