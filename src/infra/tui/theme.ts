export const C = {
  bg: "#1a1b26",
  bg2: "#24283b",
  blue: "#7AA2F7",
  green: "#9ECE6A",
  red: "#F7768E",
  yellow: "#E0AF68",
  purple: "#BB9AF7",
  cyan: "#7DCFFF",
  text: "#A9B1D6",
  dim: "#565F89",
  orange: "#FF9E64",
} as const;

export type ThemeColor = (typeof C)[keyof typeof C];
