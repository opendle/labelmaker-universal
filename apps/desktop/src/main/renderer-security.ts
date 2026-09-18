interface RendererFrame {
  readonly url: string;
}

interface RendererEvent {
  readonly sender: {
    readonly id: number;
    readonly mainFrame: RendererFrame;
  };
  readonly senderFrame: RendererFrame | null;
}

/** Permit only the local application page, with an optional fragment. */
export function isApplicationUrl(url: string, applicationUrl: string): boolean {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href === applicationUrl;
  } catch {
    return false;
  }
}

/** Accept IPC only from the main frame of an application window. */
export function assertApplicationSender(
  event: RendererEvent,
  applicationWindowIds: ReadonlySet<number>,
  applicationUrl: string,
): void {
  if (
    !applicationWindowIds.has(event.sender.id) ||
    event.senderFrame === null ||
    event.senderFrame !== event.sender.mainFrame ||
    !isApplicationUrl(event.senderFrame.url, applicationUrl)
  ) {
    throw new Error("The request did not come from the application window");
  }
}
