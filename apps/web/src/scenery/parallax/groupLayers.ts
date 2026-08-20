/**
 * Depth-aware grouping. Depth bands do the landscape work (ground is not one
 * cardboard cutout). Connected components keep a compact object — a person,
 * a tree, a hut — on one card instead of splitting it across two Z planes.
 */
import { PARALLAX_MAX_LAYERS, PARALLAX_MIN_LAYERS, PARALLAX_TARGET_LAYERS } from "./types";

export interface LayerGrouping {
  readonly layerIndex: Uint8Array;
  readonly layerZ: ReadonlyArray<number>;
}

const FINE_BINS = 12;
const MIN_COMPONENT_FRACTION = 0.0035;

export function groupDepthLayers(
  depth: Float32Array,
  width: number,
  height: number,
  targetLayers = PARALLAX_TARGET_LAYERS,
): LayerGrouping {
  const count = width * height;
  if (count === 0) {
    return { layerIndex: new Uint8Array(0), layerZ: [1] };
  }

  const wanted = Math.min(PARALLAX_MAX_LAYERS, Math.max(PARALLAX_MIN_LAYERS, targetLayers));
  const binOf = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const value = depth[i] ?? 1;
    binOf[i] = Math.min(FINE_BINS - 1, Math.max(0, Math.floor(value * FINE_BINS)));
  }

  const { labels, componentCount } = connectedComponents(binOf, width, height);
  const merged = mergeSmallComponents(labels, componentCount, depth, width, height);
  return clusterComponents(merged.labels, merged.componentCount, depth, wanted);
}

function connectedComponents(
  bins: Uint8Array,
  width: number,
  height: number,
): { labels: Int32Array; componentCount: number } {
  const count = width * height;
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    parent[i] = i;
  }

  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) {
      root = parent[root]!;
    }
    let cursor = index;
    while (cursor !== root) {
      const next = parent[cursor]!;
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };

  const unite = (a: number, b: number) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) {
      parent[pb] = pa;
    }
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const bin = bins[i];
      if (x + 1 < width && bins[i + 1] === bin) {
        unite(i, i + 1);
      }
      if (y + 1 < height && bins[i + width] === bin) {
        unite(i, i + width);
      }
    }
  }

  const labels = new Int32Array(count);
  const remap = new Map<number, number>();
  let componentCount = 0;
  for (let i = 0; i < count; i++) {
    const root = find(i);
    let id = remap.get(root);
    if (id === undefined) {
      id = componentCount;
      remap.set(root, id);
      componentCount += 1;
    }
    labels[i] = id;
  }
  return { labels, componentCount };
}

function mergeSmallComponents(
  labels: Int32Array,
  componentCount: number,
  depth: Float32Array,
  width: number,
  height: number,
): { labels: Int32Array; componentCount: number } {
  const count = width * height;
  const minSize = Math.max(24, Math.floor(count * MIN_COMPONENT_FRACTION));
  const sizes = new Int32Array(componentCount);
  const depthSum = new Float32Array(componentCount);
  for (let i = 0; i < count; i++) {
    const id = labels[i]!;
    sizes[id] = (sizes[id] ?? 0) + 1;
    depthSum[id] = (depthSum[id] ?? 0) + depth[i]!;
  }

  const alias = new Int32Array(componentCount);
  for (let i = 0; i < componentCount; i++) {
    alias[i] = i;
  }

  const votes = Array.from({ length: componentCount }, () => new Map<number, number>());
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const id = labels[i]!;
      if (sizes[id]! >= minSize) {
        continue;
      }
      const tally = (index: number) => {
        const other = labels[index]!;
        if (other === id) {
          return;
        }
        const map = votes[id]!;
        map.set(other, (map.get(other) ?? 0) + 1);
      };
      if (x + 1 < width) {
        tally(i + 1);
      }
      if (x > 0) {
        tally(i - 1);
      }
      if (y + 1 < height) {
        tally(i + width);
      }
      if (y > 0) {
        tally(i - width);
      }
    }
  }

  for (let id = 0; id < componentCount; id++) {
    if (sizes[id]! >= minSize) {
      continue;
    }
    const ownDepth = sizes[id]! > 0 ? depthSum[id]! / sizes[id]! : 1;
    let best = -1;
    let bestVote = -1;
    let bestDelta = Infinity;
    for (const [neighbor, vote] of votes[id] ?? []) {
      const neighborDepth =
        sizes[neighbor]! > 0 ? depthSum[neighbor]! / sizes[neighbor]! : ownDepth;
      const delta = Math.abs(neighborDepth - ownDepth);
      if (vote > bestVote || (vote === bestVote && delta < bestDelta)) {
        best = neighbor;
        bestVote = vote;
        bestDelta = delta;
      }
    }
    if (best >= 0) {
      alias[id] = best;
    }
  }

  const resolve = (id: number): number => {
    const seen: number[] = [];
    let root = id;
    while (alias[root] !== root && !seen.includes(root)) {
      seen.push(root);
      root = alias[root]!;
    }
    const canonical = alias[root] === root ? root : Math.min(root, ...seen);
    for (const node of seen) {
      alias[node] = canonical;
    }
    alias[root] = canonical;
    return canonical;
  };

  const compact = new Map<number, number>();
  let next = 0;
  const remapped = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const root = resolve(labels[i]!);
    let id = compact.get(root);
    if (id === undefined) {
      id = next;
      compact.set(root, id);
      next += 1;
    }
    remapped[i] = id;
  }
  return { labels: remapped, componentCount: Math.max(1, next) };
}

function clusterComponents(
  labels: Int32Array,
  componentCount: number,
  depth: Float32Array,
  wanted: number,
): LayerGrouping {
  const count = labels.length;
  const sizes = new Int32Array(componentCount);
  const depthSum = new Float32Array(componentCount);
  for (let i = 0; i < count; i++) {
    const id = labels[i]!;
    sizes[id] = (sizes[id] ?? 0) + 1;
    depthSum[id] = (depthSum[id] ?? 0) + depth[i]!;
  }

  const medians: number[] = [];
  for (let id = 0; id < componentCount; id++) {
    medians.push(sizes[id]! > 0 ? depthSum[id]! / sizes[id]! : 1);
  }

  const order = medians
    .map((value, id) => ({ id, value }))
    .sort((left, right) => left.value - right.value);

  const layerCount = Math.max(1, Math.min(wanted, componentCount));
  const componentLayer = new Uint8Array(componentCount);
  // Quantile cuts over components, weighted toward more near-field slices
  // by using equal component counts (near objects are usually smaller).
  for (let index = 0; index < order.length; index++) {
    const layer = Math.min(layerCount - 1, Math.floor((index / order.length) * layerCount));
    componentLayer[order[index]!.id] = layer;
  }

  const layerIndex = new Uint8Array(count);
  const layerDepthSum = new Float32Array(layerCount);
  const layerSize = new Int32Array(layerCount);
  for (let i = 0; i < count; i++) {
    const layer = componentLayer[labels[i]!]!;
    layerIndex[i] = layer;
    layerDepthSum[layer] = (layerDepthSum[layer] ?? 0) + depth[i]!;
    layerSize[layer] = (layerSize[layer] ?? 0) + 1;
  }

  const used: number[] = [];
  const remap = new Uint8Array(layerCount);
  for (let layer = 0; layer < layerCount; layer++) {
    if (layerSize[layer]! > 0) {
      remap[layer] = used.length;
      used.push(layer);
    }
  }
  if (used.length !== layerCount) {
    for (let i = 0; i < count; i++) {
      layerIndex[i] = remap[layerIndex[i]!]!;
    }
  }

  const layerZ = used.map((layer) =>
    layerSize[layer]! > 0 ? layerDepthSum[layer]! / layerSize[layer]! : 1,
  );
  return { layerIndex, layerZ };
}
