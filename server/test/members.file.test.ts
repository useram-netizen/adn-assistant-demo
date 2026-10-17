import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGeo } from '../src/geo/index.js';
import { createMemberDirectory } from '../src/members/directory.js';
import { decodeCsv, parseMemberCsv } from '../src/members/readFile.js';
import { testApp, testConfig, testDeps } from './helpers.js';

const HEADER =
  'AND,Profession Type(s),State(s),County/Parish Coverage,Membership Tier,Contact Email,Founding Member (ADN)';
const GOOD_ROW =
  'Jane Lawyer,Lawyer- Divorce and Family Law,Georgia,Fulton County,Gold,jane@example.com,';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adn-members-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('reading a member CSV', () => {
  it('reads UTF-8, with or without a byte order mark', () => {
    const text = `${HEADER}\nDoña Ana Pro,Mediator,New Mexico,Doña Ana County,Gold,a@example.com,\n`;
    for (const bytes of [
      Buffer.from(text, 'utf8'),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]),
    ]) {
      const rows = parseMemberCsv(bytes);
      expect(rows[0]?.AND).toBe('Doña Ana Pro');
      expect(rows[0]?.['County/Parish Coverage']).toBe('Doña Ana County');
      expect(Object.keys(rows[0] ?? {})[0]).toBe('AND');
    }
  });

  it('reads what Excel’s plain "CSV" export makes (Windows-1252), instead of "Do�a Ana"', () => {
    const text = `${HEADER}\nTammy Gruen CDFA®,Financial,New Mexico,Doña Ana County,Gold,t@example.com,\n`;
    // Windows-1252: ñ is 0xF1 and ® is 0xAE, which are not valid UTF-8 on their own.
    const bytes = Buffer.from(text, 'latin1');
    expect(decodeCsv(bytes).encoding).toBe('windows-1252');
    const [row] = parseMemberCsv(bytes);
    expect(row?.AND).toBe('Tammy Gruen CDFA®');
    expect(row?.['County/Parish Coverage']).toBe('Doña Ana County');
    expect(decodeCsv(Buffer.from(text, 'utf8')).encoding).toBe('utf-8');
  });
});

describe('the member directory and a bad file', () => {
  const config = () => testConfig({ MEMBERS_FILE: join(dir, 'members.csv') });
  const geo = createGeo(testConfig().paths.countiesFile);

  it('keeps the list it has when a later reload finds a file with nobody searchable', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line) => void errors.push(String(line)));
    await writeFile(join(dir, 'members.csv'), `${HEADER}\n${GOOD_ROW}\n`);
    const directory = await createMemberDirectory({ config: config(), geo });
    expect(directory.all()).toHaveLength(1);
    expect(directory.report.searchable.total).toBe(1);

    // A file whose rows have no email: every member would be left out of every search.
    await writeFile(
      join(dir, 'members.csv'),
      `${HEADER}\nJane Lawyer,Lawyer- Divorce and Family Law,Georgia,Fulton County,Gold,,\n`,
    );
    await directory.reload();
    expect(directory.all()).toHaveLength(1);
    expect(errors.join('\n')).toContain('members_reload_rejected');

    // A column that was renamed: the import refuses the file, and the list stays.
    await writeFile(
      join(dir, 'members.csv'),
      `${HEADER.replace('Contact Email', 'Mail address')}\n${GOOD_ROW}\n`,
    );
    await directory.reload();
    expect(directory.all()).toHaveLength(1);
    expect(errors.join('\n')).toContain('members_reload_failed');

    // A good file replaces it.
    await writeFile(
      join(dir, 'members.csv'),
      `${HEADER}\n${GOOD_ROW}\nPat Mediator,Mediator,Georgia,Cobb County,Silver,pat@example.com,\n`,
    );
    await directory.reload();
    expect(directory.all()).toHaveLength(2);
  });

  it('starts empty (never crashing) when the file is unusable, and says so on /api/health with a 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await writeFile(
      join(dir, 'members.csv'),
      `${HEADER.replace('Contact Email', 'Mail address')}\n${GOOD_ROW}\n`,
    );
    const directory = await createMemberDirectory({ config: config(), geo });
    expect(directory.all()).toEqual([]);
    const deps = await testDeps({ directory });
    const res = await request(await testApp({}, { deps })).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, members: 0 });
  });
});
