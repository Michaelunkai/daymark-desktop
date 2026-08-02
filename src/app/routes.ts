export type DaymarkRoute = "today" | "inbox" | "upcoming" | `project:${string}` | `label:${string}` | `filter:${string}`

export function isProjectRoute(route: DaymarkRoute): route is `project:${string}` {
  return route.startsWith("project:")
}

export function routeProjectId(route: DaymarkRoute): string | null {
  return isProjectRoute(route) ? route.slice("project:".length) : null
}
