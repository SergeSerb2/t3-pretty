import { useEffect, useId, useState } from "react";
import { create } from "zustand";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

type Prompt = {
  readonly title: string;
  readonly confirmLabel: string;
  readonly initialName: string;
};

type Request = Prompt & { readonly resolve: (name: string | null) => void };

const useRequest = create<{ request: Request | null }>(() => ({ request: null }));

export function requestProjectFolderName(prompt: Prompt): Promise<string | null> {
  useRequest.getState().request?.resolve(null);
  return new Promise((resolve) => useRequest.setState({ request: { ...prompt, resolve } }));
}

function finish(name: string | null) {
  const request = useRequest.getState().request;
  useRequest.setState({ request: null });
  request?.resolve(name);
}

export function ProjectFolderNameDialogHost() {
  const request = useRequest((state) => state.request);
  useEffect(() => () => finish(null), []);
  return request ? <ProjectFolderNameDialog request={request} /> : null;
}

function ProjectFolderNameDialog({ request }: { readonly request: Request }) {
  const id = useId();
  const [name, setName] = useState(request.initialName);
  const canSave = name.trim().length > 0;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finish(null);
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (trimmed.length === 0) return;
            finish(trimmed);
          }}
        >
          <DialogHeader>
            <DialogTitle>{request.title}</DialogTitle>
            <DialogDescription>Shown on the project rail.</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="grid gap-1.5">
              <Label htmlFor={id}>Name</Label>
              <Input
                id={id}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                maxLength={40}
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => finish(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {request.confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
