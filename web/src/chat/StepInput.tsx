import { copy } from '@adn/copy';
import type { Ref } from 'react';
import type { ChatController } from '../flow/controller';
import { stepOptions, type OptionItem } from '../flow/options';
import type { ChatState } from '../flow/types';
import type { PublicConfig } from '../lib/api';
import { Combobox } from './Combobox';
import { ContactForm } from './ContactForm';
import { ExternalIcon } from './icons';
import { OptionList } from './OptionList';
import { ResultCards } from './ResultCards';

interface StepInputProps {
  state: ChatState;
  controller: ChatController;
  links: PublicConfig['links'];
  /** id of the bot message that asks the current question. */
  labelledBy?: string;
  ref?: Ref<HTMLDivElement>;
}

type LinkName = 'join' | 'uk_site' | 'articles' | 'podcast' | 'booking';

function LinkButton({
  href,
  label,
  onClick,
}: {
  href: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <a
      className="adn-link-button"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
    >
      <span>{label}</span> <span className="adn-sr-only">{copy.widget.opensInNewTab}</span>
      <ExternalIcon />
    </a>
  );
}

/** What the visitor can do at the current step: buttons, a dropdown, cards, or a form. */
export function StepInput({ state, controller, links, labelledBy, ref }: StepInputProps) {
  const { step } = state;
  const choose = (id: string) => controller.choose(id);
  const linkButton = (name: LinkName, href: string | null, label: string) =>
    href ? (
      <LinkButton href={href} label={label} onClick={() => controller.trackLink(name)} />
    ) : null;

  if (state.retry) {
    return (
      <div className="adn-input" ref={ref} tabIndex={-1}>
        <button type="button" className="adn-primary" onClick={() => controller.retryLast()}>
          {copy.widget.retry}
        </button>
      </div>
    );
  }
  if (!step) return null;

  const options = (items: readonly OptionItem[]) => (
    <OptionList options={items} onChoose={choose} labelledBy={labelledBy} />
  );

  let content;
  if (state.confirm) {
    content = (
      <OptionList
        options={[
          { id: 'yes', label: copy.fallback.yes },
          { id: 'no', label: copy.fallback.no },
        ]}
        onChoose={(id) => controller.confirmAnswer(id === 'yes')}
        labelledBy={labelledBy}
      />
    );
  } else {
    switch (step) {
      case 'location':
        content = (
          <>
            <Combobox
              label={copy.steps.location.comboLabel}
              placeholder={copy.steps.location.comboPlaceholder}
              noResults={copy.steps.location.noResults}
              options={state.lists.states.map((item) => ({ value: item.code, label: item.name }))}
              onSelect={choose}
            />
            {options(stepOptions(step, state))}
          </>
        );
        break;
      case 'county':
        content = (
          <>
            <Combobox
              label={copy.steps.county.comboLabel}
              placeholder={copy.steps.county.comboPlaceholder}
              noResults={copy.steps.county.noResults}
              options={state.lists.counties.map((item) => ({ value: item.fips, label: item.name }))}
              onSelect={choose}
            />
            {options(stepOptions(step, state))}
          </>
        );
        break;
      case 'pro_info':
        content = (
          <>
            {linkButton('join', links.join, copy.steps.proInfo.joinButton)}
            {options(stepOptions(step, state))}
          </>
        );
        break;
      case 'uk':
        content = (
          <>
            {linkButton('uk_site', links.ukSite, copy.steps.uk.button)}
            {options(stepOptions(step, state))}
          </>
        );
        break;
      case 'results':
        content = state.results && (
          <ResultCards
            results={state.results}
            labelledBy={labelledBy}
            onToggle={(id) => controller.toggleSelected(id)}
            onShowMore={() => controller.showMore()}
            onContact={() => controller.contactSelected()}
          />
        );
        break;
      case 'contact':
      case 'tracy':
        content = state.form && (
          <ContactForm
            // A fresh form for each time the step is shown.
            key={`${step}-${state.stepSeq}`}
            form={state.form}
            privacyUrl={links.privacy}
            onDraft={(values) => controller.saveDraft(values)}
            onSubmit={(values) => controller.submitForm(values)}
            onPrivacyClick={() => controller.trackLink('privacy')}
          />
        );
        break;
      case 'done': {
        const suggestions = stepOptions(step, state);
        const hasSuggestions = state.answers.category && suggestions.length > 1;
        content = (
          <>
            {(links.articles || links.podcast || links.booking) && (
              <div className="adn-links">
                {linkButton('articles', links.articles, copy.steps.whatsNext.articles)}
                {linkButton('podcast', links.podcast, copy.steps.whatsNext.podcast)}
                {linkButton('booking', links.booking, copy.steps.whatsNext.booking)}
              </div>
            )}
            {state.done?.kind === 'pros' && hasSuggestions && (
              <p className="adn-step-note">{copy.steps.whatsNext.anotherTypeMessage}</p>
            )}
            {options(state.done?.kind === 'pros' ? suggestions : suggestions.slice(-1))}
          </>
        );
        break;
      }
      case 'county_help':
      case 'category':
        content = null;
        break;
      default:
        content = options(stepOptions(step, state));
    }
  }

  if (!content) return null;
  return (
    <div className="adn-input" ref={ref} tabIndex={-1}>
      {content}
    </div>
  );
}
