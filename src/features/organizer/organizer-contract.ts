export type OrganizerSectionId = "calendar" | "tasks" | "notes" | "diary"

export type OrganizerRoute = "upcoming" | "today" | "notes" | "diary"

export type OrganizerIconName = "upcoming" | "tasks" | "note" | "diary"

export interface OrganizerSection {
  id: OrganizerSectionId
  label: string
  route: OrganizerRoute
  icon: OrganizerIconName
  description: string
}

export const ORGANIZER_SECTIONS: readonly OrganizerSection[] = [
  {
    id: "calendar",
    label: "Calendar",
    route: "upcoming",
    icon: "upcoming",
    description: "Plan the days ahead",
  },
  {
    id: "tasks",
    label: "Tasks",
    route: "today",
    icon: "tasks",
    description: "Keep the next step visible",
  },
  {
    id: "notes",
    label: "Notes",
    route: "notes",
    icon: "note",
    description: "Keep context with the work",
  },
  {
    id: "diary",
    label: "Diary",
    route: "diary",
    icon: "diary",
    description: "Make space to reflect",
  },
]

const ORGANIZER_EMPTY_STATES: Record<
  Exclude<OrganizerSectionId, "calendar" | "tasks">,
  {
    title: string
    description: string
    primaryLabel: string
    secondaryLabel: string
  }
> = {
  notes: {
    title: "Your notes will live here",
    description:
      "Capture context beside the work it supports. Notes are ready to become a shared part of your daily workspace.",
    primaryLabel: "Open tasks",
    secondaryLabel: "Open calendar",
  },
  diary: {
    title: "A quiet place for the day",
    description:
      "Use your diary to slow down, notice patterns, and carry the useful parts of today into tomorrow.",
    primaryLabel: "Open today",
    secondaryLabel: "Open calendar",
  },
}

export function getOrganizerSection(
  route: string,
): OrganizerSection | undefined {
  return ORGANIZER_SECTIONS.find((section) => section.route === route)
}

export function getOrganizerRoute(sectionId: OrganizerSectionId): OrganizerRoute {
  return ORGANIZER_SECTIONS.find((section) => section.id === sectionId)?.route ?? "today"
}

export function isOrganizerRoute(route: string): route is OrganizerRoute {
  return ORGANIZER_SECTIONS.some((section) => section.route === route)
}

export function getOrganizerEmptyState(
  sectionId: Exclude<OrganizerSectionId, "calendar" | "tasks">,
) {
  return ORGANIZER_EMPTY_STATES[sectionId]
}

export type OrganizerNavigationKeyAction =
  | { type: "focus"; sectionId: OrganizerSectionId }
  | { type: "none" }

export function getOrganizerNavigationKeyAction(
  currentSectionId: OrganizerSectionId,
  key: string,
): OrganizerNavigationKeyAction {
  const currentIndex = ORGANIZER_SECTIONS.findIndex(
    (section) => section.id === currentSectionId,
  )
  if (currentIndex < 0) return { type: "none" }

  if (key === "Home") {
    return { type: "focus", sectionId: ORGANIZER_SECTIONS[0].id }
  }
  if (key === "End") {
    return {
      type: "focus",
      sectionId: ORGANIZER_SECTIONS[ORGANIZER_SECTIONS.length - 1].id,
    }
  }
  if (key === "ArrowDown" || key === "ArrowRight") {
    return {
      type: "focus",
      sectionId:
        ORGANIZER_SECTIONS[
          Math.min(ORGANIZER_SECTIONS.length - 1, currentIndex + 1)
        ].id,
    }
  }
  if (key === "ArrowUp" || key === "ArrowLeft") {
    return {
      type: "focus",
      sectionId: ORGANIZER_SECTIONS[Math.max(0, currentIndex - 1)].id,
    }
  }

  return { type: "none" }
}
