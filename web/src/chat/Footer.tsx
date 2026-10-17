import { copy } from '@adn/copy';

/** A middle dot between footer items. The spaces stay readable; the dot is decorative. */
function Separator() {
  return (
    <>
      {' '}
      <span className="adn-separator" aria-hidden="true">
        ·
      </span>{' '}
    </>
  );
}

/** "Automated assistant · General information only, not legal advice · Privacy", on every screen. */
export function Footer({ privacyUrl }: { privacyUrl: string | null }) {
  return (
    <footer className="adn-footer">
      <span>{copy.footer.automated}</span>
      <Separator />
      <span>{copy.footer.disclaimer}</span>
      {privacyUrl && (
        <>
          <Separator />
          <a href={privacyUrl} target="_blank" rel="noopener noreferrer">
            {copy.footer.privacy} <span className="adn-sr-only">{copy.widget.opensInNewTab}</span>
          </a>
        </>
      )}
    </footer>
  );
}
