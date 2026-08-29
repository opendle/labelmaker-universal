import { useEffect, useState } from "react";

import type { DrawingImageResult } from "./drawing-image.js";
import type { IconCatalogEntry } from "./icon-catalog.js";
import { IconLibraryDialog } from "./IconLibraryDialog.js";

export function IconLibraryControl({
  onAdd,
  onClose,
  onError,
}: {
  readonly onAdd: (result: DrawingImageResult) => string | undefined;
  readonly onClose: () => void;
  readonly onError: () => void;
}) {
  const [icons, setIcons] = useState<readonly IconCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void import("./icon-catalog.js")
      .then(({ loadIconCatalog }) => loadIconCatalog())
      .then((loadedIcons) => {
        if (active) setIcons(loadedIcons);
      })
      .catch(() => {
        if (active) setIcons([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <IconLibraryDialog
      icons={icons}
      loading={loading}
      onAdd={(name) => {
        onClose();
        void import("./icon-image.js")
          .then(({ drawingResultFromIcon }) => drawingResultFromIcon(name))
          .then((result) => {
            if (!result) throw new Error("The icon has no visible pixels.");
            onAdd(result);
          })
          .catch(onError);
      }}
      onClose={onClose}
    />
  );
}
