import { extendTailwindMerge } from "tailwind-merge";

/** Custom @theme tokens from `src/index.css` — keep in sync with `--spacing-*`, `--container-*`, etc. */
const customSpacing = [
  "sidebar",
  "index",
  "header",
  "actionbar",
  "row",
  "control",
  "control-lg",
  "progress",
  "icon-sm",
  "icon",
  "palette-top",
  "palette-list",
  "jobs-pane",
] as const;

const customContainers = ["reading", "flashcards"] as const;

const customTextSizes = [
  "2xs",
  "read",
  "flashcard-q",
  // Arbor text styles (`@utility text-*` in index.css)
  "display",
  "title",
  "reading-title",
  "heading",
  "reading",
  "body",
  "small",
  "caption",
  "micro",
  "label",
  "kbd",
] as const;

const customZIndex = ["dropdown", "drawer", "overlay", "dialog", "floating", "toast"] as const;

export const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [...customTextSizes],
      radius: ["xs"],
      shadow: ["card"],
      ease: ["out-soft"],
    },
    classGroups: {
      "max-w": [{ "max-w": [...customContainers] }],
      w: [{ w: [...customSpacing, ...customContainers] }],
      h: [{ h: [...customSpacing] }],
      "min-h": [{ "min-h": ["row"] }],
      "max-h": [{ "max-h": ["palette-list", "jobs-pane"] }],
      top: [{ top: [...customSpacing] }],
      size: [{ size: ["icon-sm", "icon", "control", "control-lg"] }],
      z: [{ z: [...customZIndex] }],
      duration: [{ duration: ["fast", "panel"] }],
      shadow: [{ shadow: ["card"] }],
      rounded: [{ rounded: ["xs"] }],
      "font-size": [{ text: [...customTextSizes] }],
    },
  },
});
