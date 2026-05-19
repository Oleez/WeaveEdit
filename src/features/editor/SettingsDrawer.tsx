import { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function SettingsDrawer({ open, onClose, children }: SettingsDrawerProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60">
      <div className="ml-auto flex h-full w-full max-w-5xl flex-col overflow-hidden border-l border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Advanced</p>
            <h2 className="text-lg font-semibold">Workflow controls</h2>
          </div>
          <Button type="button" variant="outline" size="icon" onClick={onClose} aria-label="Close settings">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-auto p-5">{children}</div>
      </div>
    </div>
  );
}
