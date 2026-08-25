export type WorkspaceReplacementChoice = "save" | "discard" | "cancel";

export type WorkspaceReplacementResolution =
  | { readonly status: "proceed" }
  | { readonly status: "canceled" }
  | {
      readonly status: "failed";
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly retryable: boolean;
      };
    };

type WorkspaceSaveResolution =
  | { readonly status: "saved" }
  | Exclude<WorkspaceReplacementResolution, { readonly status: "proceed" }>;

export function replacementChoiceFromResponse(
  response: number,
): WorkspaceReplacementChoice {
  if (response === 0) return "save";
  if (response === 1) return "discard";
  return "cancel";
}

export async function resolveWorkspaceReplacement(
  hasUnsavedChanges: boolean,
  document: unknown,
  choose: () => Promise<WorkspaceReplacementChoice>,
  save: (document: unknown) => Promise<WorkspaceSaveResolution>,
): Promise<WorkspaceReplacementResolution> {
  if (!hasUnsavedChanges) return { status: "proceed" };
  const choice = await choose();
  if (choice === "discard") return { status: "proceed" };
  if (choice === "cancel") return { status: "canceled" };
  const result = await save(document);
  return result.status === "saved" ? { status: "proceed" } : result;
}
