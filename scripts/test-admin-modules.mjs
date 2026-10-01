import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const catalogUrl = new URL("../src/utils/admin-modules.ts", import.meta.url);

test("shared module catalog provides every left navigation destination once", async () => {
  assert.ok(existsSync(catalogUrl), "a shared catalog must replace separate parent and editor menus");
  const { contentModules, adminNavigationGroups, isContentModule } = await import(catalogUrl.href);
  assert.deepEqual(adminNavigationGroups.map(group => group.label), ["常用", "记录", "站点"]);
  assert.deepEqual(adminNavigationGroups.flatMap(group => group.items.map(item => item.id)), [
    "dashboard", "writing", "routines", "notebooks", "dynamic", "places",
    "settings", "announcements", "friends", "navigation", "gallery", "sponsors", "feeds",
  ]);
  assert.deepEqual(contentModules.map(item => item.id), [
    "routines", "notebooks", "dynamic", "places", "friends", "navigation", "gallery", "sponsors", "feeds",
  ]);
  assert.deepEqual(contentModules.filter(item => item.isList).map(item => item.id), ["friends", "navigation", "gallery", "sponsors", "feeds"]);
  for (const item of contentModules) {
    assert.equal(isContentModule(item.id), true);
    assert.ok(item.label && item.icon && item.group);
  }
  assert.equal(isContentModule("announcements"), false);
  assert.equal(isContentModule("../posts"), false);
});

test("page resolution keeps legacy content and admin-prefixed links compatible", async () => {
  assert.ok(existsSync(catalogUrl), "page aliases must be handled by the shared catalog");
  const { resolveAdminPage } = await import(catalogUrl.href);
  for (const id of ["dashboard", "writing", "routines", "notebooks", "settings", "announcements", "dynamic", "places", "friends", "navigation", "gallery", "sponsors", "feeds"]) {
    assert.equal(resolveAdminPage("#" + id), id);
    assert.equal(resolveAdminPage("#admin-" + id), id);
  }
  assert.equal(resolveAdminPage("#content"), "dynamic");
  assert.equal(resolveAdminPage("#admin-content"), "dynamic");
  assert.equal(resolveAdminPage(""), "dashboard");
  assert.equal(resolveAdminPage("#unknown"), "dashboard");
  assert.equal(resolveAdminPage("#../posts"), "dashboard");
});
