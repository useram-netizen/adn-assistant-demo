export interface ComboOption {
  value: string;
  label: string;
}

/** Lower case, no accents, no punctuation or spaces: "Doña Ana" matches "dona". */
function key(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Options that contain the text: an option whose value is the text first ("GA" is Georgia, the
 * way people type a state), then those whose name starts with it, then the rest.
 */
export function filterOptions(options: readonly ComboOption[], text: string): ComboOption[] {
  const wanted = key(text);
  if (!wanted) return [...options];
  const exact: ComboOption[] = [];
  const starts: ComboOption[] = [];
  const contains: ComboOption[] = [];
  for (const option of options) {
    const name = key(option.label);
    if (key(option.value) === wanted) exact.push(option);
    else if (name.startsWith(wanted)) starts.push(option);
    else if (name.includes(wanted)) contains.push(option);
  }
  return [...exact, ...starts, ...contains];
}
