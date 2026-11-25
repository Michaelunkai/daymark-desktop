import type { CommandDefinition } from "./CommandPalette";

export function filterCommands(
  commands: readonly CommandDefinition[],
  query: string,
): readonly CommandDefinition[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) {
    return commands;
  }

  return commands.filter((command) =>
    [command.label, command.description ?? "", ...(command.keywords ?? [])]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedQuery),
  );
}
