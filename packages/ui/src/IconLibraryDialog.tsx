import { Search, X } from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

import { CatalogIcon } from "./CatalogIcon.js";
import { IconButton } from "./controls.js";
import type { IconCatalogEntry } from "./icon-catalog.js";
import { Modal } from "./Modal.js";

function matchingIcons(
  icons: readonly IconCatalogEntry[],
  query: string,
): readonly IconCatalogEntry[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return icons;
  return icons.filter(({ label }) =>
    terms.every((term) => label.toLocaleLowerCase().includes(term)),
  );
}

function iconColumnCount(list: HTMLUListElement): number {
  const items = Array.from(list.children);
  const firstTop = items[0]?.getBoundingClientRect().top;
  if (firstTop !== undefined) {
    const nextRowIndex = items.findIndex(
      (item) => item.getBoundingClientRect().top > firstTop + 1,
    );
    if (nextRowIndex > 0) return nextRowIndex;
  }
  const availableWidth = Math.max(0, list.clientWidth - 20);
  return availableWidth > 0
    ? Math.max(1, Math.floor((availableWidth + 6) / 82))
    : 9;
}

export function IconLibraryDialog({
  icons,
  onAdd,
  onClose,
}: {
  readonly icons: readonly IconCatalogEntry[];
  readonly onAdd: (name: string) => void;
  readonly onClose: () => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  const filteredIcons = useMemo(
    () => matchingIcons(icons, query),
    [icons, query],
  );
  const [selectedName, setSelectedName] = useState<string | null>(
    icons[0]?.name ?? null,
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

  const addIcon = (name: string | null) => {
    if (name) onAdd(name);
  };

  const iconCountLabel = `${filteredIcons.length.toLocaleString()} ${
    filteredIcons.length === 1 ? "icon" : "icons"
  }`;

  const updateFilter = (event: ChangeEvent<HTMLInputElement>) => {
    const nextQuery = event.target.value;
    const nextIcons = matchingIcons(icons, nextQuery);
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
    const columns = listRef.current ? iconColumnCount(listRef.current) : 1;
    if (event.key === "ArrowRight") {
      nextIndex = Math.min(filteredIcons.length - 1, index + 1);
    } else if (event.key === "ArrowDown") {
      nextIndex = Math.min(filteredIcons.length - 1, index + columns);
    } else if (event.key === "ArrowLeft") {
      if (index === 0) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      nextIndex = index - 1;
    } else if (event.key === "ArrowUp") {
      if (index < columns) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      nextIndex = index - columns;
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
        {filteredIcons.map((icon, index) => (
          <li key={icon.name}>
            <button
              aria-pressed={icon.name === selectedName}
              className="icon-library-item"
              onClick={() => setSelectedName(icon.name)}
              onDoubleClick={() => addIcon(icon.name)}
              onFocus={() => setSelectedName(icon.name)}
              onKeyDown={(event) => onIconKeyDown(event, index)}
              tabIndex={icon.name === selectedName ? 0 : -1}
              title={icon.label}
              type="button"
            >
              <CatalogIcon icon={icon} size={26} />
              <span>{icon.label}</span>
            </button>
          </li>
        ))}
        {filteredIcons.length === 0 && (
          <li className="icon-library-empty">
            {icons.length === 0
              ? "The icon library could not open."
              : "No icons match your search."}
          </li>
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
