import * as NodeModule from "node:module";

try {
  NodeModule.enableCompileCache();
} catch {
  // Node < 22.8, or NODE_COMPILE_CACHE already configured the cache.
}
