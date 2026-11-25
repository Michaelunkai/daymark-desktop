export type DiscoveryShortcutAction = "command" | "search" | "shortcut-help" | null;

export interface DiscoveryKeyEvent {
  altKey: boolean;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  key: string;
  metaKey: boolean;
}

export function getDiscoveryShortcutAction(
  event: DiscoveryKeyEvent,
  isEditable: boolean,
): DiscoveryShortcutAction {
  if (event.defaultPrevented || isEditable) {
    return null;
  }

  if (!event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
    return "command";
  }

  if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === "/") {
    return "search";
  }

  if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === "?") {
    return "shortcut-help";
  }

  return null;
}
