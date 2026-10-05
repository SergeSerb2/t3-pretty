import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// `border-continuous` (uniwind's borderCurve) is not a border color or width;
// without its own group twMerge drops it beside any other `border-*` class.
const twMerge = extendTailwindMerge<"border-curve">({
  extend: { classGroups: { "border-curve": ["border-continuous"] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
