import type { Config } from '../config/env.js';
import type { Geo, ImportReport, MatchInput, Member, MemberDirectory } from '../domain/types.js';
import { log } from '../lib/log.js';
import { emptyImportReport, importMembers } from './import.js';
import { match } from './match.js';
import { readOverridesFile } from './overrides.js';
import { readMemberFile } from './readFile.js';

/** How often the member file is read again (spec: "every 10 minutes"). */
export const MEMBER_RELOAD_MS = 10 * 60_000;

interface Snapshot {
  members: readonly Member[];
  byId: ReadonlyMap<string, Member>;
  report: ImportReport;
  loadedAt: Date;
}

function snapshotOf(members: readonly Member[], report: ImportReport): Snapshot {
  return { members, byId: new Map(members.map((m) => [m.id, m])), report, loadedAt: new Date() };
}

/** Reads and imports the member file. Throws if the file or overrides can't be used. */
export async function loadMembers(config: Pick<Config, 'paths'>, geo: Geo): Promise<Snapshot> {
  const [rows, overrides] = await Promise.all([
    readMemberFile(config.paths.membersFile),
    readOverridesFile(config.paths.overridesFile),
  ]);
  const { members, report } = importMembers(rows, {
    geo,
    overrides,
    file: config.paths.membersFile,
  });
  return snapshotOf(members, report);
}

/**
 * The members, in memory. The member file is the source of truth: it is read at startup and
 * again by reload(). If the file is missing or unreadable at startup the site still runs,
 * with no members (every search finds nobody and offers the Email Tracy form); if a later
 * reload fails, the previous list stays.
 */
export async function createMemberDirectory({
  config,
  geo,
}: {
  config: Pick<Config, 'paths'>;
  geo: Geo;
}): Promise<MemberDirectory> {
  let current: Snapshot;
  try {
    current = await loadMembers(config, geo);
    log.info('members_loaded', {
      members: current.report.members,
      searchable: current.report.searchable.total,
      warnings: current.report.warnings.length,
    });
  } catch (error) {
    // Never print the file's content: an import error names a column or a line, not a person.
    log.error('members_load_failed', { error: error instanceof Error ? error.message : 'unknown' });
    current = snapshotOf(
      [],
      emptyImportReport(config.paths.membersFile, ['Could not load members']),
    );
  }

  return {
    get loadedAt() {
      return current.loadedAt;
    },
    get report() {
      return current.report;
    },
    all: () => current.members,
    get: (id) => current.byId.get(id),
    match: (input: MatchInput, seed: string) => match(current.members, input, seed),
    async reload() {
      try {
        const next = await loadMembers(config, geo);
        current = next;
        log.info('members_reloaded', {
          members: next.report.members,
          searchable: next.report.searchable.total,
        });
      } catch (error) {
        log.error('members_reload_failed', {
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    },
  };
}

/** Re-reads the member file every `intervalMs`. Returns a function that stops it. */
export function startMemberReload(
  directory: Pick<MemberDirectory, 'reload'>,
  intervalMs: number = MEMBER_RELOAD_MS,
): () => void {
  const timer = setInterval(() => void directory.reload(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
