import { copy } from '@adn/copy';
import type { PublicConfig } from '../lib/api';

/**
 * The steps of the conversation. M1 has the welcome step and the first message of each
 * branch; M3 adds the rest of the flow from the spec.
 */
export type StepId = 'welcome' | 'location' | 'pro_info';

export interface StepOption {
  /** Option value (the spec's answer values; never shown to the visitor). */
  id: string;
  label: string;
  next: StepId;
}

export interface StepLink {
  label: string;
  href: string;
}

export interface StepView {
  /** The bot's messages for this step, in order. */
  messages: string[];
  /** Buttons that answer the step. */
  options: StepOption[];
  /** A link button, for end steps that send the visitor elsewhere. */
  link?: StepLink;
}

export function stepView(step: StepId, config: PublicConfig): StepView {
  switch (step) {
    case 'welcome':
      return {
        messages: [copy.steps.welcome.message],
        options: [
          { id: 'divorce', label: copy.steps.welcome.optionDivorce, next: 'location' },
          { id: 'professional', label: copy.steps.welcome.optionProfessional, next: 'pro_info' },
        ],
      };
    case 'location':
      return {
        messages: [copy.steps.location.message, copy.steps.location.comingSoon],
        options: [],
      };
    case 'pro_info':
      return {
        messages: [copy.steps.proInfo.message],
        options: [],
        // JOIN_URL is OPEN; the button is hidden until it is set.
        link: config.links.join
          ? { label: copy.steps.proInfo.joinButton, href: config.links.join }
          : undefined,
      };
  }
}

/** The bot's reply when the visitor types instead of choosing (no AI before M4). */
export function fallbackReply(view: StepView): string {
  return view.options.length > 0 || view.link
    ? copy.fallback.didNotCatch
    : copy.fallback.didNotCatchNoOptions;
}
