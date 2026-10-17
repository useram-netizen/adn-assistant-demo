import { copy } from '@adn/copy';
import { useId, useRef, useState, type FormEvent } from 'react';
import {
  MESSAGE_MAX,
  NAME_MAX,
  validateContact,
  type ContactErrors,
  type ContactField,
} from '../flow/form';
import type { ContactValues, FormState } from '../flow/types';

interface ContactFormProps {
  form: FormState;
  privacyUrl: string | null;
  /** Called as the visitor types, so Back and forward again don't lose their words. */
  onDraft: (values: ContactValues) => void;
  onSubmit: (values: ContactValues) => void;
  onPrivacyClick: () => void;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p className="adn-field-error" id={id}>
      {message}
    </p>
  ) : null;
}

const FIELD_ORDER: ContactField[] = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'message',
  'consent',
];

/**
 * The contact form (spec: "Contact form"), for the professionals the visitor picked or for
 * Tracy. It checks the same things as the server, with friendly messages, and shows
 * the problems next to the fields. The hidden "trap" field is for bots.
 */
export function ContactForm({
  form,
  privacyUrl,
  onDraft,
  onSubmit,
  onPrivacyClick,
}: ContactFormProps) {
  const base = useId();
  const [values, setValues] = useState<ContactValues>(form.values);
  const [errors, setErrors] = useState<ContactErrors>({});
  const [attempted, setAttempted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const tracy = form.kind === 'tracy';

  const change = <K extends keyof ContactValues>(field: K, value: ContactValues[K]) => {
    const next = { ...values, [field]: value };
    setValues(next);
    onDraft(next);
    // Once the visitor has tried to send, keep the messages up to date as they fix things.
    if (attempted) setErrors(validateContact(next));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (form.submitting) return;
    const found = validateContact(values);
    setErrors(found);
    setAttempted(true);
    const first = FIELD_ORDER.find((field) => found[field]);
    if (first) {
      formRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
      return;
    }
    onSubmit(values);
  };

  const idOf = (field: string) => `${base}-${field}`;
  const errorOf = (field: ContactField) => errors[field];
  const describedBy = (field: ContactField, hint?: string) =>
    [errorOf(field) ? `${idOf(field)}-error` : null, hint].filter(Boolean).join(' ') || undefined;

  const messageLeft = MESSAGE_MAX - values.message.length;

  return (
    <form className="adn-form" ref={formRef} onSubmit={submit} noValidate>
      {attempted && Object.keys(errors).length > 0 && (
        <p className="adn-form-summary" role="alert">
          {copy.form.errors.summary}
        </p>
      )}

      <div className="adn-field">
        <label htmlFor={idOf('firstName')}>{copy.form.firstName}</label>
        <input
          id={idOf('firstName')}
          data-field="firstName"
          type="text"
          autoComplete="given-name"
          maxLength={NAME_MAX}
          value={values.firstName}
          aria-required="true"
          aria-invalid={Boolean(errorOf('firstName'))}
          aria-describedby={describedBy('firstName')}
          onChange={(event) => change('firstName', event.target.value)}
        />
        <FieldError id={`${idOf('firstName')}-error`} message={errorOf('firstName')} />
      </div>

      <div className="adn-field">
        <label htmlFor={idOf('lastName')}>{copy.form.lastName}</label>
        <input
          id={idOf('lastName')}
          data-field="lastName"
          type="text"
          autoComplete="family-name"
          maxLength={NAME_MAX}
          value={values.lastName}
          aria-required="true"
          aria-invalid={Boolean(errorOf('lastName'))}
          aria-describedby={describedBy('lastName')}
          onChange={(event) => change('lastName', event.target.value)}
        />
        <FieldError id={`${idOf('lastName')}-error`} message={errorOf('lastName')} />
      </div>

      <div className="adn-field">
        <label htmlFor={idOf('email')}>{copy.form.email}</label>
        <input
          id={idOf('email')}
          data-field="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          value={values.email}
          aria-required="true"
          aria-invalid={Boolean(errorOf('email'))}
          aria-describedby={describedBy('email')}
          onChange={(event) => change('email', event.target.value)}
        />
        <FieldError id={`${idOf('email')}-error`} message={errorOf('email')} />
      </div>

      <div className="adn-field">
        <label htmlFor={idOf('phone')}>{copy.form.phone}</label>
        <input
          id={idOf('phone')}
          data-field="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={40}
          value={values.phone}
          aria-invalid={Boolean(errorOf('phone'))}
          aria-describedby={describedBy('phone')}
          onChange={(event) => change('phone', event.target.value)}
        />
        <FieldError id={`${idOf('phone')}-error`} message={errorOf('phone')} />
      </div>

      <fieldset className="adn-field adn-radios">
        <legend>{tracy ? copy.form.preferredTracy : copy.form.preferred}</legend>
        {(['email', 'phone'] as const).map((choice) => (
          <label key={choice} className="adn-radio">
            <input
              type="radio"
              name={`${base}-preferred`}
              value={choice}
              checked={values.preferredContact === choice}
              onChange={() => change('preferredContact', choice)}
            />
            <span>{choice === 'email' ? copy.form.preferredEmail : copy.form.preferredPhone}</span>
          </label>
        ))}
      </fieldset>

      <div className="adn-field">
        <label htmlFor={idOf('message')}>{copy.form.message}</label>
        <textarea
          id={idOf('message')}
          data-field="message"
          rows={5}
          maxLength={MESSAGE_MAX}
          value={values.message}
          aria-required="true"
          aria-invalid={Boolean(errorOf('message'))}
          aria-describedby={describedBy('message', `${idOf('message')}-hint`)}
          onChange={(event) => change('message', event.target.value)}
        />
        <p className="adn-hint" id={`${idOf('message')}-hint`}>
          {copy.form.messageHint} <span aria-hidden="true">({messageLeft})</span>
        </p>
        <FieldError id={`${idOf('message')}-error`} message={errorOf('message')} />
      </div>

      <div className="adn-field adn-consent">
        <label className="adn-checkbox">
          <input
            data-field="consent"
            type="checkbox"
            checked={values.consent}
            aria-required="true"
            aria-invalid={Boolean(errorOf('consent'))}
            aria-describedby={describedBy('consent')}
            onChange={(event) => change('consent', event.target.checked)}
          />
          <span>
            {tracy ? copy.form.consentTracy : copy.form.consent}
            {privacyUrl && (
              <>
                {' '}
                <a
                  href={privacyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onPrivacyClick}
                >
                  {copy.form.privacyLink}{' '}
                  <span className="adn-sr-only">{copy.widget.opensInNewTab}</span>
                </a>
              </>
            )}
          </span>
        </label>
        <FieldError id={`${idOf('consent')}-error`} message={errorOf('consent')} />
      </div>

      {/* The trap: hidden from people and from screen readers; bots fill in every field. */}
      <div className="adn-trap" aria-hidden="true">
        <label>
          {copy.form.honeypot}
          <input
            type="text"
            name="company_fax"
            tabIndex={-1}
            autoComplete="off"
            value={values.trap}
            onChange={(event) => change('trap', event.target.value)}
          />
        </label>
      </div>

      {form.error && (
        <p className="adn-form-error" role="alert">
          {form.error}
        </p>
      )}

      <button type="submit" className="adn-primary" disabled={form.submitting}>
        {form.submitting
          ? copy.form.sending
          : form.error
            ? copy.widget.retry
            : tracy
              ? copy.form.submitTracy
              : copy.form.submit}
      </button>
    </form>
  );
}
