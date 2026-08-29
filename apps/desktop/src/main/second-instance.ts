export interface SecondInstanceActions {
  readonly development: boolean;
  readonly focusCurrentWindow: () => void;
  readonly quit: () => void;
  readonly relaunch: () => void;
}

/** Relaunch a development build so a second `npm run dev` uses fresh output. */
export function handleSecondInstance(actions: SecondInstanceActions): void {
  if (actions.development) {
    actions.relaunch();
    actions.quit();
    return;
  }
  actions.focusCurrentWindow();
}
