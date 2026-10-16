/**
 * All visitor-facing wording for the ADN assistant (spec rule 6).
 *
 * The widget imports this file as `@adn/copy`, and the server uses it for embed.js.
 * Later milestones add the rest of the flow and the emails here, so the client's
 * final wording can be dropped into this one file.
 *
 * The wording is a placeholder (OPEN) until Tracy confirms it. The welcome text and
 * button labels are the spec's placeholders.
 *
 * Keep this file plain data: no imports, because the browser bundle includes it.
 */
export const copy = {
  widget: {
    /** Browser tab title when /widget is opened on its own. */
    documentTitle: 'Amicable Divorce Network assistant',
    noscript: 'Please turn on JavaScript to use the Amicable Divorce Network assistant.',
    /** Shown if this server is running without a widget build. */
    unavailable:
      'The Amicable Divorce Network assistant is not available right now. Please try again later.',
    headerTitle: 'Amicable Divorce Network',
    headerSubtitle: 'Find a vetted divorce professional',
    /** Screen reader name of the message list. */
    conversationLabel: 'Conversation with the assistant',
    /** Screen reader text before each message. */
    assistantSaid: 'Assistant:',
    youSaid: 'You:',
    typing: 'The assistant is typing…',
    back: 'Back',
    startOver: 'Start over',
    inputLabel: 'Type a message',
    inputPlaceholder: 'Type a message…',
    send: 'Send',
    opensInNewTab: '(opens in a new tab)',
    loadError:
      "Sorry, I couldn't load the assistant just now. Please check your connection and try again.",
    retry: 'Try again',
  },

  /** The footer on every screen. "Privacy" links to PRIVACY_URL and is hidden while that is unset. */
  footer: {
    automated: 'Automated assistant',
    disclaimer: 'General information only, not legal advice',
    privacy: 'Privacy',
  },

  /** Text that embed.js puts on the host page. */
  embed: {
    bubbleLabel: 'Find a professional',
    closeLabel: 'Close',
    /** The iframe title, read out by screen readers. Also used in the fallback iframe code. */
    frameTitle: 'Find a divorce professional',
  },

  /** Replies used when the assistant can't interpret typed text (and while the AI is off). */
  fallback: {
    didNotCatch: "Sorry, I didn't catch that. You can pick one of these:",
    didNotCatchNoOptions: "Sorry, I didn't catch that. You can use Back or Start over below.",
  },

  steps: {
    welcome: {
      message:
        "Hi! I'm the Amicable Divorce Network assistant. I can help you find vetted divorce professionals near you. Are you…",
      optionDivorce: "I'm going through a divorce or considering one",
      optionProfessional: "I'm a divorce professional",
    },
    location: {
      message: 'Which state are you in?',
      /** M1 only: the state picker arrives in M3. Remove this line then. */
      comingSoon:
        "The state list isn't connected yet in this early test version. You can go back or start over.",
    },
    proInfo: {
      message:
        'Welcome! The Amicable Divorce Network connects people going through a divorce with professionals who are committed to amicable divorce. You can find out about membership and how to join here.',
      joinButton: 'Learn about joining',
    },
  },
} as const;

export type Copy = typeof copy;
