import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef } from "react";

import { type SlowRpcAckRequest, useSlowRpcAckRequests } from "../rpc/requestLatencyState";
import { environmentPresentations } from "../state/presentation";
import { toastManager } from "./ui/toast";

function describeSlowRequests(requests: ReadonlyArray<SlowRpcAckRequest>): string {
  const count = requests.length;
  // Thresholds vary per method, so report the smallest one the batch has passed.
  const thresholdSeconds = Math.round(
    Math.min(...requests.map((request) => request.thresholdMs)) / 1000,
  );

  return `${count} request${count === 1 ? "" : "s"} waiting longer than ${thresholdSeconds}s.`;
}

function SlowRequestDetails({ requests }: { requests: ReadonlyArray<SlowRpcAckRequest> }) {
  const presentationById = useAtomValue(environmentPresentations.presentationsAtom);
  // Only disambiguate when the batch actually spans environments; a single
  // environment's name is noise next to every row.
  const spansEnvironments = new Set(requests.map((request) => request.environmentId)).size > 1;
  return (
    <ul className="space-y-2.5 text-xs text-muted-foreground">
      {requests.map((request) => {
        const environmentLabel =
          spansEnvironments && request.environmentId !== undefined
            ? presentationById.get(request.environmentId)?.entry.target.label
            : undefined;
        return (
          <li
            className="min-w-0 border-border/50 border-b pb-2 last:border-b-0 last:pb-0"
            key={request.requestId}
          >
            <div className="wrap-break-word font-medium text-foreground">
              {environmentLabel === undefined
                ? request.tag
                : `${request.tag} · ${environmentLabel}`}
            </div>
            <div className="mt-0.5 text-[10px] opacity-75">
              Started {new Date(request.startedAt).toLocaleTimeString()}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function SlowRpcRequestToastCoordinator() {
  const slowRequests = useSlowRpcAckRequests();
  const toastIdRef = useRef<ReturnType<typeof toastManager.add> | null>(null);

  useEffect(() => {
    if (slowRequests.length === 0) {
      if (toastIdRef.current !== null) {
        toastManager.close(toastIdRef.current);
        toastIdRef.current = null;
      }
      return;
    }

    const nextToast = {
      data: {
        expandableContent: <SlowRequestDetails requests={slowRequests} />,
        expandableDescriptionTrigger: true,
        expandableLabels: { collapse: "Hide requests", expand: "Show requests" },
      },
      description: describeSlowRequests(slowRequests),
      timeout: 0,
      title: "Some requests are slow",
      type: "warning" as const,
    };

    if (toastIdRef.current === null) {
      toastIdRef.current = toastManager.add(nextToast);
    } else {
      toastManager.update(toastIdRef.current, nextToast);
    }
  }, [slowRequests]);

  useEffect(
    () => () => {
      if (toastIdRef.current !== null) {
        toastManager.close(toastIdRef.current);
      }
    },
    [],
  );

  return null;
}
