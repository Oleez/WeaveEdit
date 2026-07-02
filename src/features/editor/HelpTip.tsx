import { Info } from "lucide-react";

/**
 * Tiny inline info icon with a native tooltip. Zero dependencies so it can sit
 * next to any label in the panel without pulling in a popover library.
 */
export function HelpTip({ text }: { text: string }) {
  return (
    <span title={text} aria-label={text} className="inline-flex cursor-help align-middle text-muted-foreground/70 hover:text-muted-foreground">
      <Info className="h-3.5 w-3.5" />
    </span>
  );
}
