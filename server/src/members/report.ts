import type { ImportReport, NotSearchableReason } from '../domain/types.js';
import { classifyLabel } from './professions.js';

/** How each reason reads in the report. */
export const NOT_SEARCHABLE_REASON_TEXT: Readonly<Record<NotSearchableReason, string>> = {
  no_tier: 'no tier',
  no_profession: 'no profession',
  supporter_only: 'supporter only (not a profession)',
  no_us_state: 'no US state',
  outside_us: 'outside the US',
  no_email: 'no email',
  no_counties: 'no counties (needed below Platinum)',
  excluded: 'excluded',
};

/** The dry-run report that `npm run import` prints. */
export function formatImportReport(report: ImportReport): string {
  const { tiers, searchable } = report;
  const lines: string[] = [
    `Member import (dry run): ${report.file}`,
    '',
    `Rows:            ${report.rows} → ${report.members} members (${plural(report.emptyRowsSkipped, 'empty row')} skipped)`,
    `Merged rows:     ${listOrNone(report.mergedMembers)}`,
    `Tiers:           silver ${tiers.silver}, gold ${tiers.gold}, platinum ${tiers.platinum}, none ${tiers.none}`,
    `Searchable:      ${searchable.total} (silver ${searchable.silver}, gold ${searchable.gold}, platinum ${searchable.platinum})`,
    `Not searchable:  ${report.notSearchable.length}`,
    `CADP badge:      ${report.badges.cadp}`,
    `Founding:        ${listOrNone(report.badges.founding)}`,
    `Inferred states: ${report.inferredStates.length}`,
    `Stripped county pieces:  ${report.strippedPieces.length}`,
    `Unmatched county pieces: ${report.unmatchedPieces.length}`,
    `Unknown professions:     ${report.unknownProfessions.length}`,
    `Overrides applied:       ${report.overridesApplied.length}`,
    `Warnings:                ${report.warnings.length}`,
  ];

  section(
    lines,
    'Not searchable',
    report.notSearchable.map(
      ({ name, reasons }) =>
        `${name}: ${reasons.map((reason) => NOT_SEARCHABLE_REASON_TEXT[reason]).join(', ')}`,
    ),
  );
  section(
    lines,
    'Inferred states',
    report.inferredStates.map(({ name, state }) => `${name} → ${state}`),
  );
  section(
    lines,
    'Stripped county pieces (extra text in front removed)',
    report.strippedPieces.map(({ member, before, after }) => `${member}: ${before} → ${after}`),
  );
  section(
    lines,
    'County pieces that matched no county in the member’s states (dropped)',
    report.unmatchedPieces.map(({ member, piece }) => `${member}: ${piece}`),
  );
  section(
    lines,
    'Unknown professions',
    report.unknownProfessions.map(({ member, label }) => {
      const info = classifyLabel(label);
      const parent = info.kind === 'unknown' ? info.parent : null;
      return `${member}: ${label} (${parent ? `counted as ${parent}` : 'ignored'})`;
    }),
  );
  section(
    lines,
    'Overrides applied (data/member-overrides.json)',
    report.overridesApplied.map(({ email, action }) => `${email}: ${action}`),
  );
  section(lines, 'Warnings', report.warnings);

  lines.push(
    '',
    'Nothing was changed. The server reads the member file itself and reloads it every',
    '10 minutes; to update the members, replace the file and deploy.',
  );
  return `${lines.join('\n')}\n`;
}

function section(lines: string[], title: string, items: readonly string[]): void {
  lines.push('', `${title} (${items.length})`);
  if (items.length === 0) lines.push('  none');
  for (const item of items) lines.push(`  - ${item}`);
}

function listOrNone(items: readonly string[]): string {
  return items.length > 0 ? items.join('; ') : 'none';
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
