import { enableCompileCache } from "node:module";

try {
  enableCompileCache();
} catch {
  // Node < 22.8, or NODE_COMPILE_CACHE already configured the cache.
}
