import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind classNames, resolving conflicts (last wins). Accepts strings
 * and falsy values (for `cond && 'class'` / `cond ? 'a' : undefined`).
 */
export function cn(...inputs: (string | false | null | undefined)[]): string {
  return twMerge(inputs.filter(Boolean).join(" "));
}
