import test from "node:test";
import assert from "node:assert/strict";
import { createLocalStore, executeContent } from "../api/_lib/content-management.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("sidebar and announcement settings are readable and version protected", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "firefly-admin-"));
  const store = createLocalStore(root);
  await fs.mkdir(path.join(root, "src/data"), { recursive: true });
  await fs.writeFile(path.join(root, "src/data/sidebar.json"), JSON.stringify({
    enable: true,
    position: "both",
    leftComponents: [],
    rightComponents: [],
    mobileBottomComponents: [],
  }));
  await fs.writeFile(path.join(root, "src/data/announcements.json"), JSON.stringify({
    title: "公告",
    closable: false,
    items: [],
  }));

  const first = await executeContent(store, "sidebar", "GET", {});
  assert.match(first.source, /"position":"both"/);
  await assert.rejects(
    executeContent(store, "sidebar", "PUT", { source: "{}", version: "wrong" }),
    (error) => error?.status === 409,
  );
});
