import { describe, expect, it, vi } from "vite-plus/test";

import {
  collectInRowReveals,
  isRevealedRow,
  REVEAL_CLASS,
  REVEAL_INTENT_MS,
  REVEAL_STAGGER_CAP,
  REVEAL_STAGGER_MS,
  revealDelayMs,
  revealIntentIsLive,
  resolveRevealIntent,
  type RevealIntent,
} from "./sceneryMotionReveals";

/** Just enough of Element for the selectors the reveal helpers use. */
class FakeElement {
  readonly nodeType = 1;
  parent: FakeElement | null = null;

  constructor(
    readonly attributes: Record<string, string> = {},
    readonly classes: ReadonlyArray<string> = [],
    readonly tagName = "DIV",
  ) {}

  append(...children: FakeElement[]): this {
    for (const child of children) child.parent = this;
    return this;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  contains(other: FakeElement): boolean {
    for (let node: FakeElement | null = other; node; node = node.parent) {
      if (node === this) return true;
    }
    return false;
  }

  closest(selector: string): FakeElement | null {
    return this.matches(selector) ? this : (this.parent?.closest(selector) ?? null);
  }

  private matches(selector: string): boolean {
    if (selector.startsWith(".")) return this.classes.includes(selector.slice(1));
    const attribute = /^\[([\w-]+)\]$/.exec(selector)?.[1];
    return attribute !== undefined && attribute in this.attributes;
  }
}

const asElement = (node: FakeElement) => node as unknown as Element;
const added = (...nodes: Array<FakeElement | { nodeType: number }>) => ({
  addedNodes: nodes as unknown as NodeList,
});

function timelineRow(id: string, controlTagName = "BUTTON") {
  const row = new FakeElement({ "data-timeline-row-id": id });
  const control = new FakeElement({ "aria-expanded": "false" }, [], controlTagName);
  const label = new FakeElement();
  control.append(label);
  row.append(control);
  return { row, control, label };
}

function intentFor(control: FakeElement, mountedRowIds: ReadonlyArray<string> = []): RevealIntent {
  return {
    control: asElement(control),
    rowId: "row",
    at: 0,
    mountedRowIds: new Set(mountedRowIds),
  };
}

describe("resolveRevealIntent", () => {
  it("captures a closed disclosure in a timeline row with the rows mounted at that moment", () => {
    const { control, label } = timelineRow("turn-fold:1");
    const readMounted = vi.fn(() => new Set(["turn-fold:1", "message:2"]));

    const intent = resolveRevealIntent(asElement(label), 120, readMounted);

    expect(intent).toMatchObject({ control, rowId: "turn-fold:1", at: 120 });
    expect(intent?.mountedRowIds).toEqual(new Set(["turn-fold:1", "message:2"]));
  });

  it("ignores closing, controls outside the timeline, and non-elements", () => {
    const readMounted = vi.fn(() => new Set<string>());
    const { control } = timelineRow("work-toggle:1");
    control.attributes["aria-expanded"] = "true";
    const outside = new FakeElement({ "aria-expanded": "false" });

    expect(resolveRevealIntent(asElement(control), 0, readMounted)).toBeNull();
    expect(resolveRevealIntent(asElement(outside), 0, readMounted)).toBeNull();
    expect(resolveRevealIntent(null, 0, readMounted)).toBeNull();
    expect(readMounted).not.toHaveBeenCalled();
  });

  it("lets the nearest disclosure own the gesture", () => {
    const { control } = timelineRow("activity-group:1");
    const openEntry = new FakeElement({ "aria-expanded": "true" });
    const insideOpenEntry = new FakeElement();
    openEntry.append(insideOpenEntry);
    control.append(openEntry);

    expect(resolveRevealIntent(asElement(insideOpenEntry), 0, () => new Set())).toBeNull();
  });
});

describe("revealIntentIsLive", () => {
  it("holds the gesture for the list's mount window only", () => {
    const intent = { ...intentFor(new FakeElement()), at: 1_000 };
    expect(revealIntentIsLive(intent, 1_000 + REVEAL_INTENT_MS)).toBe(true);
    expect(revealIntentIsLive(intent, 1_001 + REVEAL_INTENT_MS)).toBe(false);
    expect(revealIntentIsLive(null, 0)).toBe(false);
  });
});

describe("collectInRowReveals", () => {
  it("returns the body the open mounted inside its own row", () => {
    const { row, control } = timelineRow("activity-group:1");
    const body = new FakeElement();
    const nested = new FakeElement();
    body.append(nested);
    row.append(body);

    expect(
      collectInRowReveals(
        [added(body, nested, { nodeType: 3 })],
        intentFor(control),
        asElement(row),
      ),
    ).toEqual([body]);
  });

  it("leaves the control, a remounted header, other rows and revealing bodies alone", () => {
    const { row, control, label } = timelineRow("reasoning:1");
    const relabel = new FakeElement();
    label.append(relabel);
    const header = new FakeElement();
    header.append(control);
    row.append(header);
    const elsewhere = new FakeElement();
    const revealing = new FakeElement({}, [REVEAL_CLASS]);
    const streamed = new FakeElement();
    revealing.append(streamed);
    row.append(revealing);

    expect(
      collectInRowReveals(
        [added(relabel, header, row, elsewhere, streamed)],
        intentFor(control),
        asElement(row),
      ),
    ).toEqual([]);
  });

  it("reveals what a role=button container opens inside itself", () => {
    const { row, control } = timelineRow("work:1", "DIV");
    const toolOutput = new FakeElement();
    control.append(toolOutput);

    expect(collectInRowReveals([added(toolOutput)], intentFor(control), asElement(row))).toEqual([
      toolOutput,
    ]);
    // The same content inside a native button is only its label changing.
    const button = timelineRow("turn-fold:1");
    const chevron = new FakeElement();
    button.label.append(chevron);
    expect(
      collectInRowReveals([added(chevron)], intentFor(button.control), asElement(button.row)),
    ).toEqual([]);
  });
});

describe("isRevealedRow", () => {
  it("reveals rows the open mounted below its header, not rows that were already there", () => {
    const intent = intentFor(new FakeElement(), ["turn-fold:1", "message:9"]);
    expect(isRevealedRow({ id: "work:3", top: 240 }, intent, 200)).toBe(true);
    expect(isRevealedRow({ id: "message:9", top: 400 }, intent, 200)).toBe(false);
    expect(isRevealedRow({ id: "work:0", top: 80 }, intent, 200)).toBe(false);
  });
});

describe("revealDelayMs", () => {
  it("cascades a few rows then caps so a long fold cannot keep rows hidden", () => {
    expect(revealDelayMs(0)).toBe(0);
    expect(revealDelayMs(2)).toBe(2 * REVEAL_STAGGER_MS);
    expect(revealDelayMs(REVEAL_STAGGER_CAP + 10)).toBe(REVEAL_STAGGER_CAP * REVEAL_STAGGER_MS);
  });
});
