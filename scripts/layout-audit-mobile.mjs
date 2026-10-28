// Mobile layout audit: every route x every dialog/editor form at phone
// viewports, INCLUDING keyboard-open heights. Asserts: every primary action
// (Save/Create/Confirm) is visible inside the visual viewport, no horizontal
// page overflow, editor surfaces fit the viewport.
// Usage: node scripts/layout-audit-mobile.mjs [--base http://127.0.0.1:18780/]
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "release", "evidence", "layout-audit-mobile");
const base = process.env.AUDIT_URL ?? "http://127.0.0.1:18780/";

const VIEWPORTS = [
  ["phone", 360, 740],
  ["phone-wide", 384, 750],
  ["phone-small", 320, 640],
  ["phone-kb", 384, 483], // keyboard open (adjustResize) — the case that hides Save buttons
  ["phone-landscape-kb", 740, 360], // landscape, worst-case short height
];

const routes = [
  ["today", "Today"],
  ["inbox", "Inbox"],
  ["upcoming", "Upcoming"],
  ["order", "Order"],
  ["notes", "Notes"],
  ["diary", "Diary"],
  ["reminders", "Reminders"],
  ["settings", "Settings"],
];

async function openSidebarRoute(page, label) {
  const row = page.locator(".sidebar-row", { hasText: label }).first();
  try {
    await row.click({ timeout: 2500 });
    return "sidebar";
  } catch {
    await page.locator(".topbar__menu").click({ timeout: 2500 });
    await page.waitForTimeout(400);
    await row.click({ timeout: 2500, force: true });
    return "drawer";
  }
}

async function dialogFits(page) {
  return page.evaluate(() => {
    const vv = window.visualViewport;
    const vh = vv ? vv.height + vv.offsetTop : window.innerHeight;
    const vw = window.innerWidth;
    const surface =
      document.querySelector('[role="dialog"]') ??
      document.querySelector(".reminder-planner__editor") ??
      document.querySelector(".order-editor") ??
      document.querySelector(".note-editor");
    const all = surface ? [...surface.querySelectorAll("button")] : [];
    // The primary action (Save/Create/Confirm) is what must never hide;
    // mid-form "Add x" buttons are fine to live behind internal scroll.
    const action = all.find((b) => /^(save|create|confirm|done|update)/i.test((b.textContent || "").trim()))
      ?? all.find((b) => /^(add|delete)/i.test((b.textContent || "").trim()));
    if (!surface) return { open: false };
    const r = surface.getBoundingClientRect();
    const ar = action?.getBoundingClientRect();
    return {
      open: true,
      surfaceTop: Math.round(r.top),
      surfaceBottom: Math.round(r.bottom),
      fitsViewport: r.top >= -1 && r.bottom <= vh + 1,
      horizontallyFits: r.left >= -1 && r.right <= vw + 1,
      canScroll: surface.scrollHeight > surface.clientHeight + 1,
      action: action
        ? {
            text: (action.textContent || "").trim().slice(0, 25),
            bottom: Math.round(ar.bottom),
            visible: ar.bottom <= vh + 1 && ar.top >= -1 && ar.right <= vw + 1 && ar.left >= -1,
          }
        : null,
      pageHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      vh: Math.round(vh),
    };
  });
}

async function closeDialog(page) {
  // Escape is not wired in every dialog; click their own cancel/close buttons first.
  const cancels = [
    ".task-editor__icon-button",
    '.project-create-overlay button:has-text("Cancel")',
    '.order-editor button:has-text("Cancel")',
    '[role="dialog"] button:has-text("Cancel")',
    '[role="dialog"] button[aria-label*="Cancel" i]',
    '[role="dialog"] button[aria-label*="Close" i]',
    '[class*="overlay"] button:has-text("Cancel")',
  ];
  for (const sel of cancels) {
    const btn = page.locator(sel).first();
    if (await btn.count()) {
      try { await btn.click({ timeout: 800 }); await page.waitForTimeout(350); } catch {}
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(350);
  const still = await page.locator('[role="dialog"], .project-create-overlay, .order-editor-overlay').count();
  if (still) {
    await page.evaluate(() => {
      document.querySelectorAll('[role="dialog"], .project-create-overlay, .order-editor-overlay, [class*="__backdrop"]').forEach((n) => n.remove());
    });
    await page.waitForTimeout(200);
  }
}

const browser = await chromium.launch({ channel: "msedge" }).catch(() => chromium.launch({ channel: "chrome" }));
await mkdir(outDir, { recursive: true });
const problems = [];
const evidence = [];

for (const [vpLabel, width, height] of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000); // full sync + render

  for (const [routeId, label] of routes) {
    await openSidebarRoute(page, label);
    await page.waitForTimeout(900);
    const audit = await page.evaluate(() => ({
      pageHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      buttons: [...document.querySelectorAll("button")].map((b) => (b.getAttribute("aria-label") || (b.textContent || "").trim().slice(0, 24))).filter((t) => /add task|new note|new reminder|add project|add workspace|new session|create|compose/i.test(t)).slice(0, 8),
    }));
    if (audit.pageHScroll) problems.push(`${vpLabel}/${routeId}: page horizontal overflow`);
    evidence.push(`${vpLabel}/${routeId}: buttons=[${audit.buttons.join(" | ")}]`);

    // Try to open each dialog reachable from this route and measure it.
    const triggers = [
      ["task-editor", async () => {
        const btn = page.locator('button[aria-label="Add task"], button:has-text("Add task")').first();
        if (await btn.count()) { await btn.click({ timeout: 2000 }); return true; }
        return false;
      }],
      ["task-edit", async () => {
        const row = page.locator(".task-row").first();
        if (await row.count()) { await row.locator("button").first().click({ timeout: 2000 }); return true; }
        return false;
      }],
      ["reminder-editor", async () => {
        const btn = page.locator('button:has-text("New reminder")').first();
        if (await btn.count()) { await btn.click({ timeout: 2000 }); return true; }
        return false;
      }],
      ["notes-new", async () => {
        const btn = page.locator('button:has-text("New note")').first();
        if (await btn.count()) { await btn.click({ timeout: 2000 }); return true; }
        return false;
      }],
      ["order-item-editor", async () => {
        const btn = page.locator('.order-header__actions button:has-text("Add item"), button:has-text("Add item")').first();
        if (await btn.count()) { await btn.click({ timeout: 2000 }); return true; }
        return false;
      }],
      ["project-dialog", async () => {
        const btn = page.locator('button[aria-label="Add project"]').first();
        if (await btn.count()) { await btn.click({ timeout: 2000 }); return true; }
        return false;
      }],
      ["workspace-dialog", async () => {
        const btn = page.locator('button[aria-label="Add workspace"]').first();
        if (await btn.count()) { await btn.click({ timeout: 2000 }); return true; }
        return false;
      }],
      ["section-add", async () => {
        const btn = page.locator('button[aria-label^="Add task to"]').first();
        if (await btn.count()) { await btn.click({ timeout: 2000 }); return true; }
        return false;
      }],
    ];
    for (const [dialogId, open] of triggers) {
      let opened = false;
      try { opened = await open(); } catch { opened = false; }
      if (!opened) continue;
      await page.waitForTimeout(900);
      const fit = await dialogFits(page);
      if (fit.open) {
        const shot = `${vpLabel}-${routeId}-${dialogId}.png`;
        await page.screenshot({ path: path.join(outDir, shot) });
        evidence.push(`${vpLabel}/${routeId}/${dialogId}: action=${fit.action?.text ?? "NONE"} visible=${fit.action?.visible} fits=${fit.fitsViewport}/${fit.horizontallyFits} scroll=${fit.canScroll}`);
        if (!fit.action?.visible) problems.push(`${vpLabel}/${routeId}/${dialogId}: action button "${fit.action?.text ?? "?"}" NOT visible (bottom=${fit.action?.bottom} > vh=${fit.vh})`);
        if (!fit.fitsViewport) problems.push(`${vpLabel}/${routeId}/${dialogId}: surface cropped top=${fit.surfaceTop} bottom=${fit.surfaceBottom} vh=${fit.vh}`);
        if (fit.pageHScroll) problems.push(`${vpLabel}/${routeId}/${dialogId}: page hscroll while dialog open`);
      }
      await closeDialog(page);
    }

    // UNIVERSAL FORMS SWEEP: any visible form whose Save/Submit primary action
    // is off-screen is a bug, whatever component it belongs to. Catches editors
    // the named triggers above don't know about (current and future).
    const sweep = await page.evaluate(() => {
      const vv = window.visualViewport;
      const vh = vv ? vv.height + vv.offsetTop : window.innerHeight;
      const vw = window.innerWidth;
      const out = [];
      for (const form of document.querySelectorAll("form")) {
        const fr = form.getBoundingClientRect();
        if (fr.width === 0 || fr.height === 0) continue;
        if (fr.bottom < 0 || fr.top > vh) continue; // entirely off-screen
        const action = [...form.querySelectorAll('button[type="submit"], button')]
          .filter((b) => /^(save|create|confirm|done|update|add task|add item|save item|save reminder|save changes|log in|apply)/i.test((b.textContent || "").trim()))
          .pop();
        if (!action) continue;
        const r = action.getBoundingClientRect();
        out.push({
          form: (form.className || form.parentElement?.className || "form").toString().slice(0, 40),
          action: (action.textContent || "").trim().slice(0, 22),
          bottom: Math.round(r.bottom),
          visible: r.bottom <= vh + 1 && r.top >= -1 && r.right <= vw + 1 && r.left >= -1,
        });
      }
      return out;
    });
    for (const f of sweep) {
      evidence.push(`${vpLabel}/${routeId} [sweep] ${f.form}: ${f.action} visible=${f.visible} bottom=${f.bottom}`);
      if (!f.visible) problems.push(`${vpLabel}/${routeId} [sweep] form "${f.form}" action "${f.action}" NOT visible (bottom=${f.bottom}, vh)`);
    }
  }
  if (errors.length) problems.push(`${vpLabel}: page errors: ${errors[0]}`);
  await context.close();
}
await browser.close();

console.log(evidence.join("\n"));
console.log("\n==== PROBLEMS (" + problems.length + ") ====");
console.log(problems.join("\n") || "none");
process.exit(problems.length ? 1 : 0);
