import type { ModelSelection, ServerConfig as T3ServerConfig } from "@t3tools/contracts";
import { useMemo } from "react";

import { buildModelOptions } from "../../lib/modelOptions";
import { resolveProviderOptionDescriptors } from "../../lib/providerOptions";
import { buildThreadModelIdentity, type ThreadModelIdentity } from "./threadModelIdentity";

export function useThreadModelIdentity(
  serverConfig: T3ServerConfig | null | undefined,
  modelSelection: ModelSelection | null | undefined,
): ThreadModelIdentity | null {
  return useMemo(() => {
    if (!modelSelection) {
      return null;
    }

    const modelOptions = buildModelOptions(serverConfig, modelSelection);
    const currentModelOption =
      modelOptions.find(
        (option) =>
          option.selection.instanceId === modelSelection.instanceId &&
          option.selection.model === modelSelection.model,
      ) ?? null;
    const optionDescriptors = resolveProviderOptionDescriptors({
      capabilities: currentModelOption?.capabilities,
      selections: modelSelection.options,
    });

    return buildThreadModelIdentity({
      modelLabel: currentModelOption?.label ?? modelSelection.model,
      providerDriver: currentModelOption?.providerDriver ?? modelSelection.instanceId,
      optionDescriptors,
    });
  }, [modelSelection, serverConfig]);
}
