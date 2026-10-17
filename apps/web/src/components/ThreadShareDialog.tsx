import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef, ThreadShareInfo } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useEnvironmentHttpBaseUrl } from "../state/environments";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "./ui/dialog";

const useShareDialog = create<{ target: ScopedThreadRef | null }>(() => ({ target: null }));
export function openThreadShareDialog(target: ScopedThreadRef) {
  useShareDialog.setState({ target });
}

export function ThreadShareDialogHost() {
  const target = useShareDialog((state) => state.target);
  return target ? (
    <ThreadShareDialog key={`${target.environmentId}:${target.threadId}`} target={target} />
  ) : null;
}

function ThreadShareDialog({ target }: { readonly target: ScopedThreadRef }) {
  const connectionUrl = useEnvironmentHttpBaseUrl(target.environmentId);
  const [baseUrl, setBaseUrl] = useState(connectionUrl ?? "");
  const [share, setShare] = useState<ThreadShareInfo | null>(null);
  const [pending, setPending] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canPublish = useAtomValue(
    threadEnvironment.publishShare.permissionAtom(target.environmentId),
  );
  const canRevoke = useAtomValue(
    threadEnvironment.revokeShare.permissionAtom(target.environmentId),
  );
  const get = useAtomCommand(threadEnvironment.getShare, { reportFailure: false });
  const publish = useAtomCommand(threadEnvironment.publishShare, { reportFailure: false });
  const revoke = useAtomCommand(threadEnvironment.revokeShare, { reportFailure: false });
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    onError: () => setError("Could not copy the link. Select and copy it from the field."),
  });
  useEffect(() => {
    let active = true;
    void get({ environmentId: target.environmentId, input: { threadId: target.threadId } }).then(
      (result) => {
        if (!active) return;
        setPending(false);
        if (result._tag === "Failure") {
          setError(String(squashAtomCommandFailure(result)));
          return;
        }
        setLoaded(true);
        setShare(result.value);
        if (result.value) setBaseUrl(new URL(result.value.url).origin);
      },
    );
    return () => {
      active = false;
    };
  }, [get, target.environmentId, target.threadId]);
  const change = async (action: "publish" | "revoke") => {
    setPending(true);
    setError(null);
    if (action === "publish") {
      const result = await publish({
        environmentId: target.environmentId,
        input: { threadId: target.threadId, publicBaseUrl: baseUrl },
      });
      if (result._tag === "Success") setShare(result.value);
      else setError(String(squashAtomCommandFailure(result)));
    } else {
      const result = await revoke({
        environmentId: target.environmentId,
        input: { threadId: target.threadId },
      });
      if (result._tag === "Success") setShare(null);
      else setError(String(squashAtomCommandFailure(result)));
    }
    setPending(false);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) useShareDialog.setState({ target: null });
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Share thread publicly</DialogTitle>
          <DialogDescription>
            Anyone with the link can read a snapshot of this conversation without signing in.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Includes user and assistant text. Excludes tool output, reasoning, attachments, and
              hidden instructions. Review the conversation for private information before sharing.
            </p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="thread-share-base">Public server URL</Label>
              <Input
                id="thread-share-base"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://your-server.example.com"
                disabled={pending}
              />
              <p className="text-xs text-muted-foreground">
                Use this environment’s public address or tunnel. The server must stay online. A
                localhost or private network address only works for people who can reach it.
              </p>
            </div>
            {share && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="thread-share-link">Public link</Label>
                <Input
                  id="thread-share-link"
                  readOnly
                  value={share.url}
                  onFocus={(event) => event.target.select()}
                />
                <p className="text-xs text-muted-foreground">
                  {share.messageCount} messages · Snapshot from{" "}
                  {new Date(share.publishedAt).toLocaleString()}. Later messages stay private until
                  you update the snapshot.
                </p>
                <div>
                  <Button variant="outline" onClick={() => copyToClipboard(share.url, undefined)}>
                    {isCopied ? "Copied" : "Copy link"}
                  </Button>
                </div>
              </div>
            )}
            {pending && (
              <p className="text-sm text-muted-foreground" role="status">
                Saving or loading shared conversation…
              </p>
            )}
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          {share && (
            <Button
              variant="destructive"
              disabled={pending || !canRevoke}
              onClick={() => void change("revoke")}
            >
              Stop sharing
            </Button>
          )}
          <Button
            disabled={pending || !loaded || !canPublish || !baseUrl.trim()}
            onClick={() => void change("publish")}
          >
            {share ? "Update snapshot" : "Create public link"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
