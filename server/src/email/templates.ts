import { copy, fill } from '../config/copy.js';
import type { Config } from '../config/env.js';
import { hasSubtypes, type CategoryKey, type StageKey } from '../config/taxonomy.js';
import type { Lead } from '../domain/types.js';
import {
  brand,
  bulletList,
  details,
  heading,
  linkList,
  paragraph,
  quote,
  renderEmail,
  type Block,
  type DetailRow,
  type EmailContent,
  type LinkItem,
} from './layout.js';

/**
 * The emails' wording comes from copy.emails (spec rule 6). Each builder returns
 * { subject, html, text }; the caller adds the recipient and Reply-To.
 *
 * - professional: to each selected professional, Reply-To the visitor
 * - copy: the same content to LEAD_COPY_TO, plus who it went to
 * - client: the visitor's confirmation, with the what's next links that are set
 * - tracy: the Email Tracy form, Reply-To the visitor
 * - client_tracy: the visitor's confirmation of their message to Tracy
 */

export type { EmailContent } from './layout.js';

/** What the visitor sent, with the place names already looked up (validated input only). */
export interface EmailRequest {
  /** The data-site key, for example "divorceamicably". */
  site: string;
  contact: Lead['contact'];
  message: string;
  /** "Georgia"; null when not known (the Tracy form from "Somewhere else"). */
  stateName: string | null;
  /** "Fulton County"; null when not known. */
  countyName: string | null;
  category: CategoryKey | null;
  /** A specific subtype, or null for "Any". */
  subcategory: string | null;
  stage: StageKey | null;
}

/** A request to professionals always has a category, a county and a state. */
export interface ProEmailRequest extends EmailRequest {
  category: CategoryKey;
  stateName: string;
  countyName: string;
}

/** The what's next links (OPEN): the ones that are not set are left out. */
export type WhatsNextLinks = Pick<Config['links'], 'articles' | 'podcast' | 'booking'>;

const emails = copy.emails;

// ---------------------------------------------------------------- Values

/** "divorceamicably" → "divorceamicably.com"; unknown keys get the generic name. */
export function siteName(site: string): string {
  const sites: Readonly<Record<string, string>> = copy.sites;
  return (Object.hasOwn(sites, site) ? sites[site] : undefined) ?? copy.sites.unknown;
}

/** "Fulton County, Georgia", just "Georgia", or null. */
export function locationText(request: Pick<EmailRequest, 'countyName' | 'stateName'>) {
  const { countyName, stateName } = request;
  if (!stateName) return null;
  return countyName ? fill(emails.values.location, { county: countyName, state: stateName }) : stateName;
}

function subtypeLabel(category: CategoryKey, subtype: string | null): string | null {
  if (!subtype || !hasSubtypes(category)) return null;
  const labels: Readonly<Record<string, string>> = copy.subtypes[category];
  return (Object.hasOwn(labels, subtype) ? labels[subtype] : undefined) ?? null;
}

/** "Divorce attorney", or "Divorce coach – Parenting coach" with a subtype. */
export function lookingForText(category: CategoryKey | null, subtype: string | null) {
  if (!category) return null;
  const label = copy.categories[category];
  const subtypeName = subtypeLabel(category, subtype);
  return subtypeName
    ? fill(emails.values.lookingForSubtype, { category: label, subtype: subtypeName })
    : label;
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/** Name, email, phone, preferred contact, location, looking for, stage and message. */
function requestDetails(request: EmailRequest): Block {
  const { contact } = request;
  const fields = emails.fields;
  const rows: DetailRow[] = [
    { label: fields.name, value: `${contact.firstName} ${contact.lastName}` },
    { label: fields.email, value: contact.email, href: `mailto:${contact.email}` },
    contact.phone
      ? { label: fields.phone, value: contact.phone, href: telHref(contact.phone) }
      : { label: fields.phone, value: fields.notGiven },
    {
      label: fields.preferred,
      value: contact.preferredContact === 'phone' ? copy.form.preferredPhone : copy.form.preferredEmail,
    },
  ];
  const location = locationText(request);
  if (location) rows.push({ label: fields.location, value: location });
  const lookingFor = lookingForText(request.category, request.subcategory);
  if (lookingFor) rows.push({ label: fields.lookingFor, value: lookingFor });
  rows.push({
    label: fields.stage,
    value: request.stage ? copy.steps.stage.options[request.stage] : fields.notGiven,
  });
  rows.push({ label: fields.message, value: request.message, quoted: true });
  return details(rows);
}

function whatsNext(links: WhatsNextLinks): Block[] {
  const labels = copy.steps.whatsNext;
  const items: LinkItem[] = [];
  if (links.articles) items.push({ label: labels.articles, href: links.articles });
  if (links.podcast) items.push({ label: labels.podcast, href: links.podcast });
  if (links.booking) items.push({ label: labels.booking, href: links.booking });
  return items.length > 0 ? [heading(emails.client.whatsNext), linkList(items)] : [];
}

// ---------------------------------------------------------------- Emails

function professionalParts(request: ProEmailRequest): { subject: string; blocks: Block[] } {
  const subject = fill(emails.pro.subject, {
    category: copy.categories[request.category],
    county: request.countyName,
    state: request.stateName,
  });
  const blocks = [
    paragraph(emails.pro.intro),
    requestDetails(request),
    paragraph(fill(emails.pro.foundYou, { site: siteName(request.site) })),
    paragraph(emails.pro.replyHint),
  ];
  return { subject, blocks };
}

/** To each selected professional (Reply-To the visitor). The same for every professional. */
export function professionalEmail(request: ProEmailRequest): EmailContent {
  const { subject, blocks } = professionalParts(request);
  return renderEmail(subject, [brand(emails.brand), ...blocks]);
}

/** LEAD_COPY_TO (OPEN): the professionals' email, plus who it went to. */
export function leadCopyEmail(request: ProEmailRequest, contacted: readonly string[]): EmailContent {
  const { subject, blocks } = professionalParts(request);
  return renderEmail(fill(emails.leadCopySubject, { subject }), [
    brand(emails.brand),
    paragraph(emails.leadCopySentTo),
    bulletList(contacted),
    ...blocks,
  ]);
}

/** The visitor's confirmation: who was contacted, their message and the what's next links. */
export function clientConfirmationEmail(
  request: EmailRequest,
  contacted: readonly string[],
  links: WhatsNextLinks,
): EmailContent {
  const wording = emails.client;
  return renderEmail(wording.subject, [
    brand(emails.brand),
    paragraph(fill(wording.greeting, { firstName: request.contact.firstName })),
    paragraph(wording.intro),
    bulletList(contacted),
    paragraph(wording.after),
    quote(request.message),
    ...whatsNext(links),
    paragraph(wording.signoff),
  ]);
}

/** The Email Tracy form (Reply-To the visitor), with why they need her and what we know. */
export function tracyEmail(request: EmailRequest, reason: 'no_match' | 'outside'): EmailContent {
  const wording = emails.tracy;
  const location = locationText(request);
  const { category } = request;

  let subject: string;
  let reasonLine: string;
  if (reason === 'outside') {
    subject = wording.subjectOutside;
    reasonLine = wording.reasonOutside;
  } else if (category && location) {
    subject = fill(wording.subject, { category: copy.categories[category], location });
    reasonLine = fill(wording.reasonNoMatch, {
      categoryWithArticle: copy.categoriesWithArticle[category],
      location,
    });
  } else {
    subject = wording.subjectGeneral;
    reasonLine = wording.reasonNoMatchGeneral;
  }

  return renderEmail(subject, [
    brand(emails.brand),
    paragraph(fill(wording.intro, { site: siteName(request.site) })),
    paragraph(reasonLine),
    requestDetails(request),
    paragraph(wording.replyHint),
  ]);
}

/** The visitor's confirmation of their message to Tracy. */
export function clientTracyEmail(request: EmailRequest, links: WhatsNextLinks): EmailContent {
  const wording = emails.clientTracy;
  return renderEmail(wording.subject, [
    brand(emails.brand),
    paragraph(fill(wording.greeting, { firstName: request.contact.firstName })),
    paragraph(wording.intro),
    paragraph(wording.after),
    quote(request.message),
    ...whatsNext(links),
    paragraph(wording.signoff),
  ]);
}
