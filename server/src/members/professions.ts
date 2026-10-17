import {
  CADP_LABEL,
  IGNORED_LABELS,
  PARENT_PREFIXES,
  SHEET_LABELS,
  SUPPORTER_LABEL,
  type SheetLabel,
} from '../config/taxonomy.js';
import type { MemberProfession } from '../domain/types.js';

/**
 * The "Profession Type(s)" column (spec: "Member import", rule 5, and "Taxonomy").
 * Labels are compared ignoring case and the spaces around "-", so "Lawyer - Divorce and
 * Family Law" and "lawyer-divorce and family law" are the same label.
 */
export function normalizeLabel(label: string): string {
  return label
    .normalize('NFKC')
    .replace(/[‐-―−]/g, '-') // typographic dashes from spreadsheets
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ ?- ?/g, '-')
    .toLowerCase();
}

const SHEET_LABEL_LIST = Object.keys(SHEET_LABELS) as SheetLabel[];
const SHEET_LABEL_BY_KEY = new Map(SHEET_LABEL_LIST.map((label) => [normalizeLabel(label), label]));
const TAXONOMY_ORDER = new Map(SHEET_LABEL_LIST.map((label, index) => [label, index]));
const CADP_KEY = normalizeLabel(CADP_LABEL);
const SUPPORTER_KEY = normalizeLabel(SUPPORTER_LABEL);
const UMBRELLA_KEYS = new Set<string>(IGNORED_LABELS.map(normalizeLabel));
const PARENTS = (Object.keys(PARENT_PREFIXES) as Array<keyof typeof PARENT_PREFIXES>).map(
  (label) => ({ prefix: `${normalizeLabel(label)}-`, label: label }),
);

export type LabelKind =
  | { kind: 'profession'; label: SheetLabel }
  /** "Certified Amicable Divorce Professional": the cadp badge, not a profession. */
  | { kind: 'cadp' }
  /** "Amicable Divorce Supporter": a business partner, not a profession. */
  | { kind: 'supporter' }
  /** "Legal" or "(ADR) Alternative Dispute Resolution": a profession that matches no category. */
  | { kind: 'umbrella' }
  /** Not in the taxonomy. "Financial - X" still belongs to "Financial" (its parent). */
  | { kind: 'unknown'; parent: SheetLabel | null };

export function classifyLabel(label: string): LabelKind {
  const key = normalizeLabel(label);
  const known = SHEET_LABEL_BY_KEY.get(key);
  if (known) return { kind: 'profession', label: known };
  if (key === CADP_KEY) return { kind: 'cadp' };
  if (key === SUPPORTER_KEY) return { kind: 'supporter' };
  if (UMBRELLA_KEYS.has(key)) return { kind: 'umbrella' };
  const parent = PARENTS.find(({ prefix }) => key.startsWith(prefix) && key.length > prefix.length);
  return { kind: 'unknown', parent: parent?.label ?? null };
}

export interface ParsedProfessions {
  /** Known professions in taxonomy order, each once. */
  professions: MemberProfession[];
  cadp: boolean;
  supporter: boolean;
  /**
   * Lists a profession: any label except the badge, the supporter flag and unknown labels
   * without a parent. "Legal" on its own counts, although it matches no category.
   */
  hasProfession: boolean;
  /** Labels that are not in the taxonomy, with the parent they were counted as (if any). */
  unknown: Array<{ label: string; parent: SheetLabel | null }>;
}

export function parseProfessions(labels: readonly string[]): ParsedProfessions {
  const result: ParsedProfessions = {
    professions: [],
    cadp: false,
    supporter: false,
    hasProfession: false,
    unknown: [],
  };
  const sheetLabels = new Set<SheetLabel>();

  for (const label of labels) {
    const info = classifyLabel(label);
    switch (info.kind) {
      case 'profession':
        sheetLabels.add(info.label);
        result.hasProfession = true;
        break;
      case 'cadp':
        result.cadp = true;
        break;
      case 'supporter':
        result.supporter = true;
        break;
      case 'umbrella':
        result.hasProfession = true;
        break;
      case 'unknown':
        result.unknown.push({ label, parent: info.parent });
        if (info.parent) {
          sheetLabels.add(info.parent);
          result.hasProfession = true;
        }
        break;
    }
  }

  result.professions = [...sheetLabels]
    .sort((a, b) => (TAXONOMY_ORDER.get(a) ?? 0) - (TAXONOMY_ORDER.get(b) ?? 0))
    .map((label) => ({ label, ...SHEET_LABELS[label] }));
  return result;
}
