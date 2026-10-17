import { copy, fill } from '@adn/copy';
import type { SituationResponse } from '@adn/api';
import type { CategoryKey, StageKey } from '@adn/taxonomy';
import type { ContactValues } from './types';

/** The spec's limit for the message (SPEC.md: "Contact form"). */
export const MESSAGE_MAX = 1500;
export const NAME_MAX = 80;

export function emptyContact(message = ''): ContactValues {
  return {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    preferredContact: 'email',
    message,
    consent: false,
    trap: '',
  };
}

export interface PrefillInput {
  analysis: SituationResponse | null;
  texts: readonly string[];
  stage: StageKey | null;
  category: CategoryKey | null;
  countyName: string | null;
  stateName: string | null;
  /** The visitor is outside the US and UK (writing to Tracy). */
  outside?: boolean;
}

/**
 * What the message box starts with (visitors can edit it): the AI's neutral summary; or, when
 * there is none, their stage followed by what they wrote themselves; or, if they wrote
 * nothing, what they are looking for.
 */
export function prefillMessage(input: PrefillInput): string {
  const summary = input.analysis?.source === 'ai' ? input.analysis.summary.trim() : '';
  let message = summary;
  if (!message) {
    const parts = [
      input.stage ? copy.form.prefillStage[input.stage] : '',
      ...input.texts.map((text) => text.trim()),
    ].filter(Boolean);
    message = parts.join(' ');
  }
  if (!message && input.category && input.countyName && input.stateName) {
    message = fill(copy.form.prefillLookingFor, {
      categoryWithArticle: copy.categoriesWithArticle[input.category],
      county: input.countyName,
      state: input.stateName,
    });
  }
  if (!message && input.outside) message = copy.form.prefillOutside;
  return message.slice(0, MESSAGE_MAX);
}

export type ContactField = 'firstName' | 'lastName' | 'email' | 'phone' | 'message' | 'consent';

export type ContactErrors = Partial<Record<ContactField, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_CHARACTERS = /^[0-9 +().-]+$/;

/** The same checks as the server (leads/validation.ts), with friendly messages. */
export function validateContact(values: ContactValues): ContactErrors {
  const errors: ContactErrors = {};
  const required = copy.form.errors.required;
  if (!values.firstName.trim()) errors.firstName = required;
  else if (values.firstName.trim().length > NAME_MAX) {
    errors.firstName = fill(copy.form.errors.tooLong, { max: NAME_MAX });
  }
  if (!values.lastName.trim()) errors.lastName = required;
  else if (values.lastName.trim().length > NAME_MAX) {
    errors.lastName = fill(copy.form.errors.tooLong, { max: NAME_MAX });
  }

  const email = values.email.trim();
  if (!email) errors.email = required;
  else if (!EMAIL.test(email) || email.length > 254) errors.email = copy.form.errors.email;

  const phone = values.phone.trim();
  if (phone) {
    const digits = phone.replace(/\D/g, '').length;
    if (!PHONE_CHARACTERS.test(phone) || digits < 7 || digits > 20) {
      errors.phone = copy.form.errors.phone;
    }
  } else if (values.preferredContact === 'phone') {
    errors.phone = copy.form.errors.phoneNeeded;
  }

  const message = values.message.trim();
  if (!message) errors.message = required;
  else if (message.length > MESSAGE_MAX) {
    errors.message = fill(copy.form.errors.tooLong, { max: MESSAGE_MAX });
  }

  if (!values.consent) errors.consent = copy.form.errors.consent;
  return errors;
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}
