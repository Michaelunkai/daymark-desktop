import { app, BrowserWindow, nativeTheme, session, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCT_NAME = "Daymark";
const PRODUCTION_ORIGIN = "https://daymark-desktop.michaelovsky55555.chatgpt.site";
const START_URL = `${PRODUCTION_ORIGIN}/`;
const SESSION_PARTITION = "persist:daymark";
const PACKAGED_LAUNCHER_NAME = "Daymark.exe";
const PACKAGED_RUNTIME_NAME = "Daymark Runtime.exe";
const SYNC_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconPath = path.join(__dirname, "assets", "daymark.ico");

let mainWindow = null;
let pendingDeepLink = null;

app.setName(PRODUCT_NAME);
app.setAppUserModelId("com.michaelunkai.daymark.windows");

const userDataArgument = process.argv.find((value) => value.startsWith("--daymark-user-data-dir="));
const requestedUserDataPath = process.env.DAYMARK_USER_DATA_DIR
  ?? userDataArgument?.slice("--daymark-user-data-dir=".length);
if (requestedUserDataPath) {
  const userDataPath = requestedUserDataPath;
  if (path.isAbsolute(userDataPath)) app.setPath("userData", userDataPath);
}

if (process.defaultApp) {
  app.setAsDefaultProtocolClient("daymark", process.execPath, [path.resolve(process.argv[1])]);
} else {
  const executableName = path.basename(process.execPath);
  const protocolExecutable = executableName === PACKAGED_RUNTIME_NAME
    ? path.join(path.dirname(process.execPath), PACKAGED_LAUNCHER_NAME)
    : process.execPath;
  app.setAsDefaultProtocolClient("daymark", protocolExecutable);
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
}

function syncUrlFromDeepLink(value) {
  try {
    const url = new URL(value);
    const key = url.protocol === "daymark:" && url.hostname === "sync"
      ? url.pathname.replace(/^\/+/, "")
      : "";
    return SYNC_PATTERN.test(key) ? `${START_URL}?sync=${encodeURIComponent(key)}` : null;
  } catch {
    return null;
  }
}

function findDeepLink(argv) {
  return argv.map(syncUrlFromDeepLink).find(Boolean) ?? null;
}

function isTrustedNavigation(value) {
  try {
    return new URL(value).origin === PRODUCTION_ORIGIN;
  } catch {
    return false;
  }
}

async function pairCanonicalWorkspace() {
  const desktopSession = session.fromPartition(SESSION_PARTITION);
  const response = await desktopSession.fetch(`${PRODUCTION_ORIGIN}/api/sync/pair-canonical`, {
    method: "POST",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Canonical pairing failed (${response.status}).`);
  const setCookies = response.headers.getSetCookie?.()
    ?? [response.headers.get("set-cookie")].filter(Boolean);
  const joinedCookies = setCookies.join(",");
  const syncKey = joinedCookies.match(/daymark\.sync-key=([^;,]+)/)?.[1] ?? "";
  if (!SYNC_PATTERN.test(syncKey)) throw new Error("Canonical pairing did not return a valid sync key.");
  const expirationDate = Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 365 * 10);
  await Promise.all([
    desktopSession.cookies.set({
      url: PRODUCTION_ORIGIN,
      name: "daymark.sync-key",
      value: syncKey,
      path: "/",
      secure: true,
      sameSite: "strict",
      expirationDate,
    }),
    desktopSession.cookies.set({
      url: PRODUCTION_ORIGIN,
      name: "daymark.canonical-workspace",
      value: "1",
      path: "/",
      secure: true,
      sameSite: "strict",
      expirationDate,
    }),
  ]);
  return `${START_URL}?sync=${encodeURIComponent(syncKey)}`;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
}

async function createWindow() {
  nativeTheme.themeSource = "dark";
  let launchUrl = pendingDeepLink ?? findDeepLink(process.argv);
  pendingDeepLink = null;
  if (!launchUrl) {
    try {
      launchUrl = await pairCanonicalWorkspace();
    } catch {
      // Existing persistent pairing remains usable while the service is offline.
    }
  }

  mainWindow = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1440,
    height: 960,
    minWidth: 640,
    minHeight: 400,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    show: false,
    icon: iconPath,
    webPreferences: {
      partition: SESSION_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      devTools: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedNavigation(url)) {
      void mainWindow.loadURL(url);
    } else {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedNavigation(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  mainWindow.webContents.on("render-process-gone", () => {
    if (!mainWindow?.isDestroyed()) void mainWindow.reload();
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, _description, url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3 && isTrustedNavigation(url)) {
      setTimeout(() => {
        if (!mainWindow?.isDestroyed()) void mainWindow.loadURL(url);
      }, 1000);
    }
  });

  mainWindow.webContents.once("did-finish-load", showMainWindow);
  mainWindow.once("ready-to-show", showMainWindow);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(launchUrl ?? START_URL);
}

app.on("second-instance", (_event, argv) => {
  const deepLink = findDeepLink(argv);
  if (deepLink && mainWindow && !mainWindow.isDestroyed()) {
    void mainWindow.loadURL(deepLink);
  } else if (deepLink) {
    pendingDeepLink = deepLink;
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  const deepLink = syncUrlFromDeepLink(url);
  if (!deepLink) return;
  if (mainWindow && !mainWindow.isDestroyed()) void mainWindow.loadURL(deepLink);
  else pendingDeepLink = deepLink;
});

app.whenReady().then(() => {
  void createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
