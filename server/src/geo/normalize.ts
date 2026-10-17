/**
 * The text normaliser for matching names in the member list: ignores case, accents, spaces
 * and punctuation, so "De Witt County" = "DeWitt County", "Doña Ana" = "Dona Ana" and
 * "Miami- Dade County" = "Miami-Dade County". It keeps letters and digits only.
 *
 * Words such as "County" and "city" are kept, so "Baltimore city" ≠ "Baltimore County".
 */
export function normalizeName(text: string): string {
  return (
    text
      // Splits accented letters into letter + accent (and full-width letters into plain ones).
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '')
  );
}
