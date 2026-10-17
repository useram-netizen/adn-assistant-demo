import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parse } from 'csv-parse/sync';
import { readSheet, type SheetData } from 'read-excel-file/node';

/** One row of the member list, keyed by the header names ("AND", "Contact Email", …). */
export type MemberRow = Record<string, string>;

export type MemberFileErrorCode = 'missing' | 'unreadable' | 'unsupported_type' | 'invalid';

/** The member file can't be used: missing, unreadable, an unsupported type, or not valid. */
export class MemberFileError extends Error {
  override name = 'MemberFileError';

  constructor(
    readonly code: MemberFileErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const MEMBER_FILE_TYPES = ['.csv', '.xlsx'] as const;

/**
 * Reads the member list from a .csv or .xlsx file (chosen by the extension). The first row
 * holds the column names; every row gets every named column, empty cells as "", values trimmed.
 */
export async function readMemberFile(path: string): Promise<MemberRow[]> {
  const type = extname(path).toLowerCase();
  if (type === '.csv') return parseMemberCsv(await readBytes(path));
  if (type === '.xlsx') return parseMemberXlsx(await readBytes(path));
  throw new MemberFileError(
    'unsupported_type',
    `${path}: unsupported file type "${type || '(none)'}"; use ${MEMBER_FILE_TYPES.join(' or ')}`,
  );
}

/** Parses CSV (UTF-8, with or without a byte order mark) into member rows. */
export function parseMemberCsv(content: string | Buffer): MemberRow[] {
  let table: string[][];
  try {
    // Blank lines are kept, so they are counted (and skipped) as empty rows.
    table = parse(content, { bom: true, relax_column_count: true, skip_empty_lines: false });
  } catch (error) {
    throw new MemberFileError('invalid', `The member file is not valid CSV: ${errorText(error)}`);
  }
  return rowsFromTable(table);
}

/** Parses the first sheet of an .xlsx workbook into member rows. */
export async function parseMemberXlsx(content: Buffer): Promise<MemberRow[]> {
  let table: SheetData;
  try {
    // The first sheet, as rows of cells (the overload without a schema).
    table = await readSheet(content, 1);
  } catch (error) {
    throw new MemberFileError(
      'invalid',
      `The member file is not a readable .xlsx workbook: ${errorText(error)}`,
    );
  }
  return rowsFromTable(table);
}

/** Turns a table (header row first) into rows keyed by the header names. */
export function rowsFromTable(table: readonly (readonly unknown[])[]): MemberRow[] {
  const [header, ...body] = table;
  if (!header || header.every((cell) => cellText(cell) === '')) {
    throw new MemberFileError(
      'invalid',
      'The member file is empty: its first row must hold the column names',
    );
  }

  const columns = header.map(cellText);
  const seen = new Set<string>();
  for (const column of columns) {
    if (column && seen.has(column)) {
      throw new MemberFileError('invalid', `The member file has two columns named "${column}"`);
    }
    seen.add(column);
  }

  return body.map((cells) => {
    const row: MemberRow = {};
    columns.forEach((column, index) => {
      // Cells under a column without a name (stray notes beside the table) are ignored.
      if (column) row[column] = cellText(cells[index]);
    });
    return row;
  });
}

function cellText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return '';
}

async function readBytes(path: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new MemberFileError('missing', `${path} does not exist`);
    throw new MemberFileError('unreadable', `${path} can't be read (${code ?? errorText(error)})`);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
