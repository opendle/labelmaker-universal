import { icons, Search, X, type LucideIcon } from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

import { IconButton } from "./controls.js";
import type { IconName } from "./icon-image.js";
import { Modal } from "./Modal.js";

interface IconEntry {
  readonly name: IconName;
  readonly label: string;
  readonly searchText: string;
  readonly Icon: LucideIcon;
}

function iconLabel(name: string): string {
  return name
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

const iconEntries = (Object.entries(icons) as [IconName, LucideIcon][]).map(
  ([name, Icon]): IconEntry => {
    const label = iconLabel(name);
    return { name, label, searchText: label.toLocaleLowerCase(), Icon };
  },
);

function matchingIcons(query: string): readonly IconEntry[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return iconEntries;
  return iconEntries.filter(({ searchText }) =>
    terms.every((term) => searchText.includes(term)),
  );
}

export function IconLibraryDialog({
  onAdd,
  onClose,
}: {
  readonly onAdd: (name: IconName) => void;
  readonly onClose: () => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  const filteredIcons = useMemo(() => matchingIcons(query), [query]);
  const [selectedName, setSelectedName] = useState<IconName | null>(
    iconEntries[0]?.name ?? null,
  );
  const selectedIndex = filteredIcons.findIndex(
    ({ name }) => name === selectedName,
  );

  const focusIcon = (index: number) => {
    listRef.current
      ?.querySelectorAll<HTMLButtonElement>(".icon-library-item")
      .item(index)
      .focus();
  };

  const addIcon = (name: IconName | null) => {
    if (name) onAdd(name);
  };

  const iconCountLabel = `${filteredIcons.length.toLocaleString()} ${
    filteredIcons.length === 1 ? "icon" : "icons"
  }`;

  const updateFilter = (event: ChangeEvent<HTMLInputElement>) => {
    const nextQuery = event.target.value;
    const nextIcons = matchingIcons(nextQuery);
    setQuery(nextQuery);
    setSelectedName(nextIcons[0]?.name ?? null);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addIcon(selectedName);
    } else if (event.key === "ArrowDown" && selectedIndex >= 0) {
      event.preventDefault();
      focusIcon(selectedIndex);
    }
  };

  const onIconKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = Math.min(filteredIcons.length - 1, index + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      if (index === 0) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      nextIndex = index - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = filteredIcons.length - 1;
    } else if (event.key === "Enter") {
      event.preventDefault();
      addIcon(filteredIcons[index]?.name ?? null);
      return;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextIcon = filteredIcons[nextIndex];
    if (!nextIcon) return;
    setSelectedName(nextIcon.name);
    focusIcon(nextIndex);
  };

  return (
    <Modal
      className="icon-library-modal"
      labelId="icon-library-title"
      onClose={onClose}
    >
      <div className="dialog-header drawing-header">
        <h2 id="icon-library-title">Icon library</h2>
        <IconButton label="Close icon library" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="icon-library-search">
        <Search aria-hidden="true" size={17} />
        <input
          aria-label="Search icons"
          data-autofocus
          onChange={updateFilter}
          onKeyDown={onSearchKeyDown}
          placeholder="Search icons"
          ref={searchRef}
          type="search"
          value={query}
        />
      </div>
      <ul aria-label="Icons" className="icon-library-list" ref={listRef}>
        {filteredIcons.map(({ name, label, Icon }, index) => (
          <li key={name}>
            <button
              aria-pressed={name === selectedName}
              className="icon-library-item"
              onClick={() => setSelectedName(name)}
              onDoubleClick={() => addIcon(name)}
              onFocus={() => setSelectedName(name)}
              onKeyDown={(event) => onIconKeyDown(event, index)}
              tabIndex={name === selectedName ? 0 : -1}
              title={label}
              type="button"
            >
              <Icon aria-hidden="true" size={26} />
              <span>{label}</span>
            </button>
          </li>
        ))}
        {filteredIcons.length === 0 && (
          <li className="icon-library-empty">No icons match your search.</li>
        )}
      </ul>
      <div className="dialog-footer icon-library-footer">
        <span aria-live="polite">{iconCountLabel}</span>
        <button
          className="button primary"
          disabled={!selectedName}
          onClick={() => addIcon(selectedName)}
          type="button"
        >
          Add icon
        </button>
      </div>
    </Modal>
  );
}
