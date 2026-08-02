import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import DaymarkApp from "./app/DaymarkApp"
import { ThemeProvider } from "./styles/theme"
import "./components/ui/ui.css"
import "./styles/theme.css"
import "./styles/app-shell.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <DaymarkApp />
    </ThemeProvider>
  </StrictMode>,
)
