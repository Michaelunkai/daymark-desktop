import DaymarkLegacy from "./DaymarkLegacy"

/**
 * The only browser entry shell. The visual workspace remains isolated so
 * feature packages can evolve behind this stable TypeScript boundary.
 */
export default function DaymarkApp() {
  return <DaymarkLegacy />
}
