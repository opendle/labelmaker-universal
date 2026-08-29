import catalogFile from "./lucide-icon-catalog.json" with { type: "json" };

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

let catalogPromise: Promise<readonly IconCatalogEntry[]> | undefined;

export function loadIconCatalog(): Promise<readonly IconCatalogEntry[]> {
  const value = catalogFile as unknown as IconCatalogFile;
  catalogPromise ??= Promise.resolve(
    Array.isArray(value.icons) && value.icons.length > 0 ? value.icons : [],
  );
  return catalogPromise;
}
