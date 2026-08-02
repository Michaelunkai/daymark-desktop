import { filterCommands } from "./command-filter.ts";
import { getDiscoveryShortcutAction } from "./shortcut-events.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const commands = [
  { id: "open-today", label: "Open Today", keywords: ["agenda"] },
  { id: "add-task", label: "Add a task", description: "Capture work" },
];

assert(filterCommands(commands, "agenda")[0]?.id === "open-today", "Keyword command matching should work.");
assert(filterCommands(commands, "capture")[0]?.id === "add-task", "Description command matching should work.");

const idle = { altKey: false, ctrlKey: false, defaultPrevented: false, key: "/", metaKey: false };
assert(getDiscoveryShortcutAction(idle, false) === "search", "Slash should open search outside editable fields.");
assert(getDiscoveryShortcutAction(idle, true) === null, "Slash must not fire while editing.");
assert(
  getDiscoveryShortcutAction({ ...idle, ctrlKey: true, key: "k" }, false) === "command",
  "Control K should open the command palette.",
);
assert(
  getDiscoveryShortcutAction({ ...idle, altKey: true, ctrlKey: true, key: "k" }, false) === null,
  "Alt-modified Control K must remain available to the browser or operating system.",
);
assert(
  getDiscoveryShortcutAction({ ...idle, key: "?" }, false) === "shortcut-help",
  "Question mark should open shortcut help.",
);

console.log("COMMAND_FEATURE_TESTS_OK");
