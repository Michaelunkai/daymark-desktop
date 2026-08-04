import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Android release exposes the shared responsive app with a launcher icon", async () => {
  const [manifest, gradle, activity, icon] = await Promise.all([
    readFile(new URL("./android/app/src/main/AndroidManifest.xml", root), "utf8"),
    readFile(new URL("./android/app/build.gradle", root), "utf8"),
    readFile(new URL("./android/app/src/main/java/com/michaelunkai/daymark/MainActivity.java", root), "utf8"),
    readFile(new URL("./android/app/src/main/res/drawable/ic_daymark.xml", root), "utf8"),
  ]);

  assert.match(manifest, /android:icon="@drawable\/ic_daymark"/);
  assert.match(manifest, /android:roundIcon="@drawable\/ic_daymark"/);
  assert.match(gradle, /versionName "1\.3\.0"/);
  assert.match(activity, /daymark-desktop\.michaelovsky55555\.chatgpt\.site/);
  assert.match(activity, /setDomStorageEnabled\(true\)/);
  assert.match(icon, /android:pathData/);
});
