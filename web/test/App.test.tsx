import { copy } from '@adn/copy';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import type { PublicConfig } from '../src/lib/api';
import type { EmbedContext } from '../src/lib/embedContext';

const CONFIG: PublicConfig = {
  links: {
    join: 'https://example.com/join',
    ukSite: 'https://amicabledivorcenetwork.co.uk/',
    articles: null,
    podcast: null,
    booking: null,
    privacy: 'https://example.com/privacy',
  },
};

const STANDALONE: EmbedContext = { site: 'divorceamicably', mode: 'standalone', framed: false };

function mockConfig(...responses: Array<PublicConfig | 'error'>) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses.length ? responses : [CONFIG]) {
    fetchMock.mockResolvedValueOnce(
      response === 'error'
        ? new Response('oops', { status: 500 })
        : new Response(JSON.stringify(response), {
            headers: { 'Content-Type': 'application/json' },
          }),
    );
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function startChat(embed: EmbedContext = STANDALONE) {
  const user = userEvent.setup();
  render(<App embed={embed} typingDelayMs={0} />);
  await screen.findByText(copy.steps.welcome.message);
  return user;
}

const log = () => screen.getByRole('log', { name: copy.widget.conversationLabel });
const option = (label: string) => screen.getByRole('button', { name: label });

describe('the M1 chat', () => {
  it('shows the welcome message with two buttons', async () => {
    mockConfig();
    await startChat();
    expect(option(copy.steps.welcome.optionDivorce)).toBeInTheDocument();
    expect(option(copy.steps.welcome.optionProfessional)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.widget.back })).toBeDisabled();
    expect(screen.getByRole('button', { name: copy.widget.startOver })).toBeDisabled();
  });

  it('shows the typing indicator while it loads', () => {
    mockConfig();
    render(<App embed={STANDALONE} typingDelayMs={0} />);
    expect(screen.getByTestId('typing')).toHaveTextContent(copy.widget.typing);
  });

  it('fetches its settings without cookies', async () => {
    const fetchMock = mockConfig();
    await startChat();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/config',
      expect.objectContaining({ credentials: 'omit' }),
    );
  });

  it('answers the divorce button with the location question', async () => {
    mockConfig();
    const user = await startChat();
    await user.click(option(copy.steps.welcome.optionDivorce));

    expect(within(log()).getByText(copy.steps.welcome.optionDivorce)).toHaveClass(
      'adn-msg--visitor',
    );
    expect(await screen.findByText(copy.steps.location.message)).toHaveClass('adn-msg--bot');
    expect(screen.queryByRole('button', { name: copy.steps.welcome.optionDivorce })).toBeNull();
    // No input on this M1 step, so focus goes to the conversation itself.
    await waitFor(() => expect(log()).toHaveFocus());
  });

  it('answers the professional button with a join link, and focuses it', async () => {
    mockConfig();
    const user = await startChat();
    await user.click(option(copy.steps.welcome.optionProfessional));

    expect(await screen.findByText(copy.steps.proInfo.message)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: new RegExp(copy.steps.proInfo.joinButton) });
    expect(link).toHaveAttribute('href', 'https://example.com/join');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await waitFor(() => expect(link).toHaveFocus());
  });

  it('hides the join link while JOIN_URL is not set', async () => {
    mockConfig({ links: { ...CONFIG.links, join: null } });
    const user = await startChat();
    await user.click(option(copy.steps.welcome.optionProfessional));
    await screen.findByText(copy.steps.proInfo.message);
    expect(
      screen.queryByRole('link', { name: new RegExp(copy.steps.proInfo.joinButton) }),
    ).toBeNull();
  });

  it('goes back and clears the answer', async () => {
    mockConfig();
    const user = await startChat();
    await user.click(option(copy.steps.welcome.optionDivorce));
    await screen.findByText(copy.steps.location.message);

    await user.click(screen.getByRole('button', { name: copy.widget.back }));
    await waitFor(() => expect(option(copy.steps.welcome.optionDivorce)).toHaveFocus());
    expect(screen.queryByText(copy.steps.location.message)).toBeNull();
    expect(within(log()).queryAllByText(copy.steps.welcome.optionDivorce)).toHaveLength(1);
  });

  it('starts over', async () => {
    mockConfig();
    const user = await startChat();
    await user.click(option(copy.steps.welcome.optionProfessional));
    await screen.findByText(copy.steps.proInfo.message);

    await user.click(screen.getByRole('button', { name: copy.widget.startOver }));
    await waitFor(() => expect(option(copy.steps.welcome.optionDivorce)).toHaveFocus());
    expect(screen.queryByText(copy.steps.proInfo.message)).toBeNull();
    expect(screen.getAllByText(copy.steps.welcome.message)).toHaveLength(1);
  });

  it('replies to typed text and repeats the buttons', async () => {
    mockConfig();
    const user = await startChat();
    const box = screen.getByRole('textbox', { name: copy.widget.inputLabel });
    expect(box).toHaveAttribute('maxlength', '1000');

    await user.type(box, 'I want a lawyer{Enter}');
    expect(within(log()).getByText('I want a lawyer')).toHaveClass('adn-msg--visitor');
    expect(await screen.findByText(copy.fallback.didNotCatch)).toBeInTheDocument();
    expect(option(copy.steps.welcome.optionDivorce)).toBeInTheDocument();
    expect(box).toHaveValue('');
    expect(box).toHaveFocus();
  });

  it('adds a new line with Shift+Enter instead of sending', async () => {
    mockConfig();
    const user = await startChat();
    const box = screen.getByRole('textbox', { name: copy.widget.inputLabel });
    await user.type(box, 'first{Shift>}{Enter}{/Shift}second');
    expect(box).toHaveValue('first\nsecond');
    expect(screen.queryByText(copy.fallback.didNotCatch)).toBeNull();
  });

  it('shows the footer with the privacy link', async () => {
    mockConfig();
    await startChat();
    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent(copy.footer.automated);
    expect(footer).toHaveTextContent(copy.footer.disclaimer);
    expect(within(footer).getByRole('link', { name: /Privacy/ })).toHaveAttribute(
      'href',
      'https://example.com/privacy',
    );
  });

  it('hides the privacy link while PRIVACY_URL is not set', async () => {
    mockConfig({ links: { ...CONFIG.links, privacy: null } });
    await startChat();
    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent(copy.footer.disclaimer);
    expect(within(footer).queryByRole('link')).toBeNull();
  });

  it('shows a friendly error with a retry button when loading fails', async () => {
    mockConfig('error', CONFIG);
    const user = userEvent.setup();
    render(<App embed={STANDALONE} typingDelayMs={0} />);

    expect(await screen.findByText(copy.widget.loadError)).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toHaveTextContent(copy.footer.automated);
    await user.click(screen.getByRole('button', { name: copy.widget.retry }));
    expect(await screen.findByText(copy.steps.welcome.message)).toBeInTheDocument();
  });

  it('never touches cookies or storage (rule 4)', async () => {
    const storage = [
      vi.spyOn(Storage.prototype, 'getItem'),
      vi.spyOn(Storage.prototype, 'setItem'),
      vi.spyOn(Storage.prototype, 'removeItem'),
    ];
    const cookieGet = vi.spyOn(Document.prototype, 'cookie', 'get');
    const cookieSet = vi.spyOn(Document.prototype, 'cookie', 'set');
    mockConfig();
    const user = await startChat();
    await user.click(option(copy.steps.welcome.optionDivorce));
    await screen.findByText(copy.steps.location.message);
    await user.click(screen.getByRole('button', { name: copy.widget.back }));
    await user.type(screen.getByRole('textbox'), 'hello{Enter}');
    await screen.findByText(copy.fallback.didNotCatch);

    for (const spy of [...storage, cookieGet, cookieSet]) expect(spy).not.toHaveBeenCalled();
  });
});

describe('inside embed.js', () => {
  function fakeParent() {
    const parent = { postMessage: vi.fn() };
    vi.spyOn(window, 'parent', 'get').mockReturnValue(parent as unknown as Window);
    return parent;
  }

  it('asks the bubble panel to close when Esc is pressed', async () => {
    mockConfig();
    const parent = fakeParent();
    const user = await startChat({ site: 'divorceamicably', mode: 'bubble', framed: true });
    await user.keyboard('{Escape}');
    expect(parent.postMessage).toHaveBeenCalledWith({ type: 'adn:close' }, '*');
  });

  it('does not send close requests outside bubble mode', async () => {
    mockConfig();
    const parent = fakeParent();
    const user = await startChat({ site: 'divorceamicably', mode: 'inline', framed: true });
    await user.keyboard('{Escape}');
    expect(parent.postMessage).not.toHaveBeenCalledWith({ type: 'adn:close' }, '*');
  });
});
