import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { useProjectTransferStore } from "./projectTransferStore";

const threadA = {
  environmentId: EnvironmentId.make("env-a"),
  threadId: ThreadId.make("thread-a"),
};
const threadB = {
  environmentId: EnvironmentId.make("env-b"),
  threadId: ThreadId.make("thread-b"),
};

function resetStore() {
  useProjectTransferStore.setState({ threadRef: null, inProgress: false });
}

describe("projectTransferStore", () => {
  afterEach(() => {
    resetStore();
  });

  it("opens a thread and clears inProgress when idle", () => {
    useProjectTransferStore.getState().open(threadA);
    expect(useProjectTransferStore.getState()).toMatchObject({
      threadRef: threadA,
      inProgress: false,
    });
    useProjectTransferStore.getState().open(threadB);
    expect(useProjectTransferStore.getState()).toMatchObject({
      threadRef: threadB,
      inProgress: false,
    });
  });

  it("ignores open while a transfer is in progress", () => {
    const store = useProjectTransferStore.getState();
    store.open(threadA);
    store.setInProgress(true);
    store.open(threadB);
    expect(useProjectTransferStore.getState()).toMatchObject({
      threadRef: threadA,
      inProgress: true,
    });
  });

  it("lets close dismiss the dialog and drop the inProgress lock", () => {
    const store = useProjectTransferStore.getState();
    store.open(threadA);
    store.setInProgress(true);
    store.close();
    expect(useProjectTransferStore.getState()).toMatchObject({
      threadRef: null,
      inProgress: false,
    });
  });
});
