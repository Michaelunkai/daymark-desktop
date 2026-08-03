import { useRef } from "react"
import { NavigationIcon } from "../navigation"
import {
  getOrganizerNavigationKeyAction,
  getOrganizerSection,
  ORGANIZER_SECTIONS,
} from "./organizer-contract"

export function OrganizerNavigation({ route, onNavigate }) {
  const buttonRefs = useRef(new Map())
  const activeSection = getOrganizerSection(route)

  const focusSection = (sectionId) => {
    buttonRefs.current.get(sectionId)?.focus()
  }

  return (
    <nav aria-label="Organizer" className="organizer-navigation">
      <div className="organizer-navigation__heading">
        <span>ORGANIZER</span>
        <span className="organizer-navigation__hint">4 spaces</span>
      </div>
      <div className="organizer-navigation__list">
        {ORGANIZER_SECTIONS.map((section) => {
          const active = activeSection?.id === section.id
          return (
            <button
              aria-current={active ? "page" : undefined}
              className={`organizer-navigation__item ${active ? "is-active" : ""}`}
              data-organizer-section={section.id}
              key={section.id}
              onClick={() => onNavigate(section.route)}
              onKeyDown={(event) => {
                const action = getOrganizerNavigationKeyAction(
                  section.id,
                  event.key,
                )
                if (action.type === "focus") {
                  event.preventDefault()
                  focusSection(action.sectionId)
                }
              }}
              ref={(element) => {
                if (element) buttonRefs.current.set(section.id, element)
                else buttonRefs.current.delete(section.id)
              }}
              title={section.description}
              type="button"
            >
              <span className="organizer-navigation__icon">
                <NavigationIcon name={section.icon} width={17} height={17} />
              </span>
              <span className="organizer-navigation__copy">
                <strong>{section.label}</strong>
                <small>{section.description}</small>
              </span>
              {active ? <span aria-hidden="true" className="organizer-navigation__active-mark" /> : null}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
