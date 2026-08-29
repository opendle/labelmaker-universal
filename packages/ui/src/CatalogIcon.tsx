import { createElement, type SVGProps } from "react";

import type { IconCatalogEntry } from "./icon-catalog.js";

export function CatalogIcon({
  icon,
  size,
}: {
  readonly icon: IconCatalogEntry;
  readonly size: number;
}) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {icon.node.map(([elementName, attributes], index) =>
        createElement(elementName, {
          ...attributes,
          key: attributes.key ?? `${elementName}-${index}`,
        } as SVGProps<SVGElement>),
      )}
    </svg>
  );
}
