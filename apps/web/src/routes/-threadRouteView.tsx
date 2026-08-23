import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";

import ChatView from "../components/ChatView";
import {
  resolveDraftPromotionNavigationTarget,
  threadHasStarted,
} from "../components/ChatView.logic";
import {
  DraftId,
  finalizePromotedDraftThreadByRef,
  markPromotedDraftThreadByRef,
  useBackgroundDraftSubmissionPending,
  useComposerDraftStore,
} from "../composerDraftStore";
import { SidebarInset } from "../components/ui/sidebar";
import { waitForDraftHeroTransition } from "../components/chat/draftHeroTransition";
import {
  buildThreadRouteParams,
  resolveThreadRouteRef,
  resolveThreadRouteRenderState,
} from "../threadRoutes";
import { resolveThreadSyncPhase } from "../threadSync";
import {
  useEnvironmentThreadRefs,
  useThreadDetail,
  useThreadRefs,
  useThreadShell,
  useThreadStatus,
} from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { environmentShell } from "../state/shell";

const SIDEBAR_INSET_CLASS =
  "h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh";

/**
 * Shared view for both thread routes: `/draft/$draftId` and
 * `/$environmentId/$threadId`. The draft route promotes to the server route a
 * few seconds after the first send (once the provider session starts), and
 * that navigation must not remount ChatView — a remount tears down every
 * glass surface for a frame, replays mount animations, re-initializes the
 * timeline, and re-runs the composer scroll correction, which reads as a
 * screen-wide flash right as the generated title lands. Registering this one
 * component on both routes lets React reconcile the swap in place, so
 * promotion is a prop change instead of a teardown.
 */
export function ThreadRouteView() {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const draftId = params.draftId ? DraftId.make(params.draftId) : null;
  const routeThreadRef = draftId ? null : resolveThreadRouteRef(params);

  // Draft flavor: resolve the draft session and the server thread it minted.
  const draftSession = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : null,
  );
  const threadRefs = useThreadRefs();
  const inferredThreadRef = draftSession
    ? (threadRefs.find(
        (ref) =>
          ref.environmentId === draftSession.environmentId &&
          ref.threadId === draftSession.threadId,
      ) ?? null)
    : null;
  const draftServerThreadRef = draftSession?.promotedTo ?? inferredThreadRef;

  const serverThreadShell = useThreadShell(routeThreadRef ?? draftServerThreadRef);
  const backgroundSubmissionPending = useBackgroundDraftSubmissionPending(draftServerThreadRef);
  const canonicalThreadRef = draftId
    ? resolveDraftPromotionNavigationTarget({
        serverThreadRef: draftServerThreadRef,
        serverThreadStarted: threadHasStarted(serverThreadShell),
        backgroundSubmissionPending,
      })
    : null;

  // Server flavor: sync/render state for the canonical thread route.
  const shell = useEnvironmentQuery(
    routeThreadRef === null ? null : environmentShell.stateAtom(routeThreadRef.environmentId),
  );
  const serverThreadDetail = useThreadDetail(routeThreadRef);
  const serverThreadStatus = useThreadStatus(routeThreadRef);
  const environmentThreadRefs = useEnvironmentThreadRefs(routeThreadRef?.environmentId ?? null);
  const bootstrapComplete = shell.data?.snapshot._tag === "Some";
  const draftThread = useComposerDraftStore((store) =>
    routeThreadRef ? store.getDraftThreadByRef(routeThreadRef) : null,
  );
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!routeThreadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(routeThreadRef.environmentId);
  });
  const renderState = resolveThreadRouteRenderState({
    bootstrapComplete,
    serverThreadShellExists: serverThreadShell !== null,
    serverThreadDetailExists: serverThreadDetail !== null,
    serverThreadDetailDeleted: serverThreadStatus === "deleted",
    draftThreadExists: draftThread !== null,
  });
  const threadSyncPhase = resolveThreadSyncPhase({
    detailExists: serverThreadDetail !== null,
    shellExists: serverThreadShell !== null,
    status: serverThreadStatus,
  });
  const serverThreadStarted = threadHasStarted(serverThreadDetail);
  const environmentHasAnyThreads = environmentThreadRefs.length > 0 || environmentHasDraftThreads;

  useEffect(() => {
    if (!draftId || !inferredThreadRef || draftSession?.promotedTo) {
      return;
    }
    markPromotedDraftThreadByRef(inferredThreadRef);
  }, [draftId, draftSession?.promotedTo, inferredThreadRef]);

  useEffect(() => {
    if (!canonicalThreadRef) {
      return;
    }

    let cancelled = false;
    void waitForDraftHeroTransition().then(() => {
      if (cancelled) {
        return;
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(canonicalThreadRef),
        replace: true,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [canonicalThreadRef, navigate]);

  useEffect(() => {
    if (!draftId || draftSession || canonicalThreadRef) {
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [canonicalThreadRef, draftId, draftSession, navigate]);

  useEffect(() => {
    if (!routeThreadRef || !bootstrapComplete) {
      return;
    }

    if (renderState === "missing" && environmentHasAnyThreads) {
      void navigate({ to: "/", replace: true });
    }
  }, [bootstrapComplete, environmentHasAnyThreads, navigate, renderState, routeThreadRef]);

  useEffect(() => {
    if (!routeThreadRef || !serverThreadStarted || !draftThread) {
      return;
    }
    finalizePromotedDraftThreadByRef(routeThreadRef);
  }, [draftThread, routeThreadRef, serverThreadStarted]);

  if (draftId) {
    if (!draftSession) {
      return null;
    }
    return (
      <SidebarInset className={SIDEBAR_INSET_CLASS}>
        <ChatView
          draftId={draftId}
          environmentId={draftSession.environmentId}
          threadId={draftSession.threadId}
          routeKind="draft"
          forceExpandedMobileComposer
        />
      </SidebarInset>
    );
  }

  if (!routeThreadRef) {
    return null;
  }

  return (
    <SidebarInset className={SIDEBAR_INSET_CLASS}>
      {renderState === "ready" || (renderState === "loading" && serverThreadShell !== null) ? (
        <ChatView
          environmentId={routeThreadRef.environmentId}
          threadId={routeThreadRef.threadId}
          routeKind="server"
          threadSyncPhase={threadSyncPhase}
        />
      ) : null}
    </SidebarInset>
  );
}
