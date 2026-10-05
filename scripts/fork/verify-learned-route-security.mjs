#!/usr/bin/env node
// Test the composed production routes before upstream sync can publish or merge.
// This gate is outside the model repair loop and contains no provider credentials.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../.."));
const routeDir = path.join(root, "packages/client-runtime/src/connection");
try {
  await access(path.join(routeDir, "routes.ts"));
} catch {
  const tag = await readFile(path.join(root, ".t3-fork/upstream-nightly"), "utf8");
  const nightly = /nightly\.(\d{8})\.(\d+)/u.exec(tag);
  if (nightly && (Number(nightly[1]) > 20261005 || (Number(nightly[1]) === 20261005 && Number(nightly[2]) >= 2689))) {
    throw new Error("Expected learned-route module is absent; refusing to skip its security gate.");
  }
  console.log("No automatic learned routes in this older source; security gate not applicable.");
  process.exit(0);
}
const testPath = path.join(routeDir, `learnedRouteSecurityGuard_${randomUUID().replaceAll("-", "")}.test.ts`);
const test = `import { expect, it } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { BearerConnectionProfile } from "./catalog.ts";
import { BearerConnectionTarget, RelayConnectionTarget } from "./model.ts";
import { connectionRoutes, entryWithRoutes, mergeLearnedRoutes } from "./routes.ts";
const environmentId = EnvironmentId.make("guard-owned-environment");
const target = new RelayConnectionTarget({environmentId, label:"Guard"});
const relay = {target, profile:Option.none()};
const entry = {...relay, enabled:true};
const direct = (httpBaseUrl:string, wsBaseUrl:string, learned?:true) => {
 const connectionId = "guard-direct";
 return {target:new BearerConnectionTarget({environmentId, label:"Guard", connectionId}),
 profile:Option.some(new BearerConnectionProfile({environmentId, label:"Guard", connectionId, httpBaseUrl, wsBaseUrl, ...(learned ? {learned} : {})}))};
};
it("never automatically learns plaintext on any client", () => {
 const input = {entry, activeRoute:relay, allowInsecure:true, reported:[
  {httpBaseUrl:"http://192.168.1.10:3773/"}, {httpBaseUrl:"http://100.101.102.103:3773/"}, {httpBaseUrl:"http://guard.example/"}]};
 expect(mergeLearnedRoutes(input)).toBeNull();
});
it("does not attempt persisted learned plaintext HTTP or WebSocket", () => {
 for (const route of [direct("http://192.168.1.10:3773/", "ws://192.168.1.10:3773/",true), direct("https://guard.example/", "ws://guard.example/",true)]) {
  expect(connectionRoutes(entryWithRoutes(entry,[route,relay]))).toEqual([relay]);
 }
});
it("preserves explicitly saved routes", () => {
 const route = direct("http://192.168.1.10:3773/", "ws://192.168.1.10:3773/");
 expect(connectionRoutes(entryWithRoutes(entry,[route,relay]))).toEqual([route,relay]);
});
it("learns a secure route with encrypted WebSocket transport", () => {
 const input = {entry, activeRoute:relay, allowInsecure:true, reported:[{httpBaseUrl:"https://guard.example/"}]};
 const routes = mergeLearnedRoutes(input);
 expect(routes).not.toBeNull();
 const profile = Option.getOrThrow(routes![0]!.profile);
 expect(profile._tag).toBe("BearerConnectionProfile");
 if (profile._tag !== "BearerConnectionProfile") throw new Error("Expected bearer route");
 expect(new URL(profile.httpBaseUrl).protocol).toBe("https:");
 expect(new URL(profile.wsBaseUrl).protocol).toBe("wss:");
});
`;
await writeFile(testPath, test, { flag: "wx" });
let result;
try {
  result = spawnSync("vp", ["test", "run", path.relative(root, testPath), "--maxWorkers=1", "--no-file-parallelism"], {
    cwd: root, stdio: "inherit", env: { ...process.env, RAYON_NUM_THREADS: "1" },
  });
} finally {
  await unlink(testPath);
}
if (result.error) throw result.error;
if (result.status !== 0) throw new Error("Learned-route transport security failed; refusing upstream publication and merge.");
