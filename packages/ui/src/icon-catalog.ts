type IconElementName =
  | "circle"
  | "ellipse"
  | "g"
  | "line"
  | "path"
  | "polygon"
  | "polyline"
  | "rect";

export type IconNode = readonly [
  elementName: IconElementName,
  attributes: Readonly<Record<string, string>>,
][];

export interface IconCatalogEntry {
  readonly name: string;
  readonly label: string;
  readonly node: IconNode;
}

interface IconCatalogFile {
  readonly icons: readonly IconCatalogEntry[];
}

const catalogUrl = new URL("./lucide-icon-catalog.json", import.meta.url).href;
let catalogPromise: Promise<readonly IconCatalogEntry[]> | undefined;

export function loadIconCatalog(): Promise<readonly IconCatalogEntry[]> {
  catalogPromise ??= fetch(catalogUrl)
    .then(async (response) => {
      if (!response.ok) throw new Error("The icon catalog could not open.");
      const value = (await response.json()) as IconCatalogFile;
      if (!Array.isArray(value.icons) || value.icons.length === 0) {
        throw new Error("The icon catalog is empty.");
      }
      return value.icons;
    })
    .catch(() => []);
  return catalogPromise;
}
