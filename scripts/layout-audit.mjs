// Targeted layout audit: load each desktop route at multiple window sizes,
// report horizontal overflow and clipped non-scrollable content, save screenshots.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "release", "windows", "evidence", "layout-audit");
const base = process.env.AUDIT_URL ?? "http://127.0.0.1:5199/";
const routes = [
  ["today", "Today"],
  ["inbox", "Inbox"],
  ["upcoming", "Upcoming"],
  ["completed", "Completed"],
  ["order", "Order"],
  ["notes", "Notes"],
  ["diary", "Diary"],
  ["reminders", "Reminders"],
  ["control", "Control Panel"],
  ["settings", "Settings"],
];
const sizes = [
  [640, 400],
  [900, 600],
  [1280, 800],
  [1728, 1000],
];

const browser = await chromium.launch({ channel: "msedge" }).catch(() => chromium.launch({ channel: "chrome" }));
await mkdir(outDir, { recursive: true });
const problems = [];

for (const [width, height] of sizes) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("response", (r) => { if (r.status() === 404) errors.push(`404 ${r.url()}`); });
  await page.goto(base);
  await page.waitForTimeout(900);
  for (const [route, label] of routes) {
    // Navigate by clicking the sidebar row with the matching label.
    const row = page.locator(".sidebar-row", { hasText: label }).first();
    try {
      await row.click({ timeout: 2500 });
    } catch {
      // At narrow widths the sidebar is a drawer behind the hamburger.
      await page.locator(".topbar__menu").click();
      await page.waitForTimeout(450);
      await page.locator(".sidebar-row", { hasText: label }).first().click({ timeout: 2500, force: true });
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(600);
    const audit = await page.evaluate(() => {
      const doc = document.documentElement;
      const issues = [];
      // 1. Horizontal overflow of the page
      if (doc.scrollWidth > doc.clientWidth + 1) issues.push(`page-hscroll ${doc.scrollWidth}>${doc.clientWidth}`);
      // 2. Elements overflowing viewport horizontally (clipped, not scrollable)
      for (const el of document.querySelectorAll(".main-content *")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const st = getComputedStyle(el);
        if (st.position === "fixed") continue;
        if (r.right > doc.clientWidth + 2 && st.overflowX !== "auto" && st.overflowX !== "scroll") {
          const scrollableAncestor = el.closest(".main-content");
          if (scrollableAncestor && scrollableAncestor.scrollWidth <= scrollableAncestor.clientWidth + 1) {
            issues.push(`clipped-right <${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 60)}" right=${Math.round(r.right)}`);
            break;
          }
        }
      }
      // 3. Main pane must be scrollable when content overflows vertically
      const main = document.querySelector(".main-content");
      if (main && main.scrollHeight > main.clientHeight + 2) {
        const st = getComputedStyle(main);
        if (!/(auto|scroll)/.test(st.overflowY)) issues.push("main-not-scrollable");
      }
      return issues;
    });
    if (audit.length) problems.push({ size: `${width}x${height}`, route, issues: audit.slice(0, 4) });
    await page.screenshot({ path: path.join(outDir, `${route}-${width}.png`), animations: "disabled", timeout: 20000 }).catch((e) => console.error(`screenshot ${route}-${width}: ${e.message.split("\n")[0]}`));
  }
  if (errors.length) problems.push({ size: `${width}x${height}`, route: "(console)", issues: errors.slice(0, 3) });
  await context.close();
}
await browser.close();
console.log(JSON.stringify(problems.length ? problems : { ok: true, checked: routes.length * sizes.length }, null, 1));
