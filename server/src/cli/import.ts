/**
 * npm run import -- data/members.csv
 *
 * A dry run: reads the member file (.csv or .xlsx), applies the import rules, and prints the
 * report. Nothing is changed. The server reads the same file itself when it starts.
 */
import { resolve } from 'node:path';
import { loadConfig } from '../config/env.js';
import { createGeo } from '../geo/index.js';
import { importMembers, ImportError } from '../members/import.js';
import { readOverridesFile, OverridesError } from '../members/overrides.js';
import { formatImportReport } from '../members/report.js';
import { MemberFileError, readMemberFile } from '../members/readFile.js';

async function main(argv: readonly string[]): Promise<number> {
  const args = argv.filter((arg) => !arg.startsWith('-'));
  const flags = argv.filter((arg) => arg.startsWith('-'));
  if (flags.includes('--apply') || flags.includes('--sync')) {
    console.error(
      'There is no --apply or --sync: members are read from the file when the server starts.\n' +
        'Replace the file and deploy to update the members.',
    );
    return 1;
  }
  if (args.length !== 1 || !args[0]) {
    console.error('Usage: npm run import -- <members.csv | members.xlsx>');
    return 1;
  }

  // npm runs scripts from the workspace folder; paths are relative to where the user ran npm.
  const file = resolve(process.env.INIT_CWD ?? process.cwd(), args[0]);
  const config = loadConfig({});
  try {
    const geo = createGeo(config.paths.countiesFile);
    const [rows, overrides] = await Promise.all([
      readMemberFile(file),
      readOverridesFile(config.paths.overridesFile),
    ]);
    const { report } = importMembers(rows, { geo, overrides, file });
    process.stdout.write(formatImportReport(report));
    return 0;
  } catch (error) {
    if (error instanceof MemberFileError || error instanceof ImportError || error instanceof OverridesError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}

process.exitCode = await main(process.argv.slice(2));
