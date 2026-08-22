/**
 * Photo sets share the World Scenery glass palette. Each set is a different
 * Unsplash catalog + seed pool. Boring is not a photo set — it turns photos off.
 */
export const PHOTO_SET_IDS = [
  "world-scenery",
  "night-cities",
  "deep-forest",
  "night-sky",
  "grand-buildings",
] as const;

export type PhotoSetId = (typeof PHOTO_SET_IDS)[number];

export const DEFAULT_PHOTO_SET_ID: PhotoSetId = "world-scenery";

export const PHOTO_SET_STORAGE_KEY = "t3code:scenery:photo-set";

export interface PhotoSetDefinition {
  readonly id: PhotoSetId;
  readonly label: string;
  readonly ariaLabel: string;
  readonly description: string;
}

export const PHOTO_SETS: ReadonlyArray<PhotoSetDefinition> = [
  {
    id: "world-scenery",
    label: "World Scenery",
    ariaLabel: "Use World Scenery landscape photos",
    description: "Places from around the world.",
  },
  {
    id: "night-cities",
    label: "Night Cities",
    ariaLabel: "Use Night Cities photos",
    description: "Rain streets, neon, and skylines after dark.",
  },
  {
    id: "deep-forest",
    label: "Deep Forest",
    ariaLabel: "Use Deep Forest photos",
    description: "Moss, fog, and old-growth woods.",
  },
  {
    id: "night-sky",
    label: "Night Sky",
    ariaLabel: "Use Night Sky photos",
    description: "Auroras, the Milky Way, and dark-sky country.",
  },
  {
    id: "grand-buildings",
    label: "Grand Buildings",
    ariaLabel: "Use Grand Buildings photos",
    description: "Cathedrals, temples, and landmark architecture.",
  },
];

const PHOTO_SET_ID_SET: ReadonlySet<string> = new Set(PHOTO_SET_IDS);

export function isPhotoSetId(value: string): value is PhotoSetId {
  return PHOTO_SET_ID_SET.has(value);
}

export function parsePhotoSetId(value: unknown): PhotoSetId {
  return typeof value === "string" && isPhotoSetId(value) ? value : DEFAULT_PHOTO_SET_ID;
}
