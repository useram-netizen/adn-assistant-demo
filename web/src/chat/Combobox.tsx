import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { filterOptions, type ComboOption } from './filterOptions';

interface ComboboxProps {
  label: string;
  placeholder: string;
  noResults: string;
  options: readonly ComboOption[];
  onSelect: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * A searchable dropdown (the ARIA 1.2 combobox with a listbox): type to filter, arrow keys to
 * move, Enter to pick, Escape to close the list. The list sits in the page flow under the box,
 * so it is never cut off by the edge of the widget, and it is long enough to scroll for a state
 * with 254 counties.
 */
export function Combobox({
  label,
  placeholder,
  noResults,
  options,
  onSelect,
  inputRef,
}: ComboboxProps) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const filtered = useMemo(() => filterOptions(options, text), [options, text]);
  const current = filtered[active];

  // Keep the highlighted option in view as the arrow keys move through a long list.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const row = list?.children[active] as HTMLElement | undefined;
    if (!list || !row) return;
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
    }
  }, [active, open]);

  const choose = (option: ComboOption) => {
    setOpen(false);
    setText('');
    onSelect(option.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) {
          setOpen(true);
          setActive(0);
        } else setActive((index) => Math.min(index + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) setOpen(true);
        else setActive((index) => Math.max(index - 1, 0));
        break;
      case 'Enter':
        if (open && current) {
          event.preventDefault();
          choose(current);
        } else if (filtered.length === 1 && filtered[0] && text) {
          event.preventDefault();
          choose(filtered[0]);
        }
        break;
      case 'Escape':
        // Closes the list only; the widget must stay open (and, in a bubble, so must the panel).
        if (open) {
          event.preventDefault();
          setOpen(false);
        }
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div className="adn-combo">
      <label className="adn-combo-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        className="adn-combo-input"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && current ? `${id}-${active}` : undefined}
        autoComplete="off"
        autoCapitalize="words"
        spellCheck={false}
        placeholder={placeholder}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      />
      <ul
        id={listId}
        ref={listRef}
        role="listbox"
        aria-label={label}
        className="adn-combo-list"
        hidden={!open}
      >
        {filtered.map((option, index) => (
          <li
            key={option.value}
            id={`${id}-${index}`}
            role="option"
            aria-selected={index === active}
            className="adn-combo-option"
            data-active={index === active}
            // mousedown, not click: the input's blur would close the list before a click lands.
            onMouseDown={(event) => {
              event.preventDefault();
              choose(option);
            }}
          >
            {option.label}
          </li>
        ))}
        {filtered.length === 0 && (
          <li role="presentation" className="adn-combo-empty">
            {noResults}
          </li>
        )}
      </ul>
    </div>
  );
}
