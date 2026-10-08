import * as Layer from "effect/Layer";

import * as EnvironmentCacheStore from "../connection/environment-cache-store";
import * as ThreadLifecycleOutboxStore from "../connection/thread-lifecycle-outbox-store";
import * as MobileDatabase from "./mobile-database";
import * as MobilePreferences from "./mobile-preferences";
import * as MobileSecureStorage from "./mobile-secure-storage";
import * as MobileStorage from "./mobile-storage";

const layerBase = Layer.merge(MobileDatabase.layer, MobileSecureStorage.layer);
const layerDependent = Layer.mergeAll(
  MobilePreferences.layer,
  MobileStorage.layer,
  EnvironmentCacheStore.layer,
  ThreadLifecycleOutboxStore.layer,
).pipe(Layer.provide(layerBase));

export const layer = Layer.merge(layerBase, layerDependent);
