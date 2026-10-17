import type { LeadRecipient, Store } from '../domain/types.js';

/** The names of the Store methods (for failure injection in tests and for log fields). */
export type StoreOperation = Exclude<keyof Store, 'kind'>;

/**
 * A Store that can say whether it has a lead when updating its recipients. ResilientStore needs
 * this to put an update where the lead actually is: in MongoDB, or in the files when the lead was
 * saved during an outage. Every store in this folder implements it.
 */
export interface LeadStore extends Store {
  /** Replaces the lead's recipients. Resolves false, changing nothing, when this store doesn't have the lead. */
  tryUpdateLeadRecipients(leadId: string, recipients: LeadRecipient[]): Promise<boolean>;
}
