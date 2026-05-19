import { ReactNode, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface DrawerTab {
  id: string;
  label: string;
  description?: string;
  content: ReactNode;
}

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  tabs?: DrawerTab[];
  /** Legacy children path: only renders when `tabs` is not supplied. */
  children?: ReactNode;
}

export function SettingsDrawer({ open, onClose, tabs, children }: SettingsDrawerProps) {
  const [activeTabId, setActiveTabId] = useState(tabs?.[0]?.id ?? "");

  if (!open) {
    return null;
  }

  const hasTabs = Array.isArray(tabs) && tabs.length > 0;
  const activeTab = hasTabs ? tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60">
      <div className="ml-auto flex h-full w-full max-w-5xl flex-col overflow-hidden border-l border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Advanced</p>
            <h2 className="text-lg font-semibold">Workflow controls</h2>
            {activeTab?.description ? (
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{activeTab.description}</p>
            ) : null}
          </div>
          <Button type="button" variant="outline" size="icon" onClick={onClose} aria-label="Close settings">
            <X className="h-4 w-4" />
          </Button>
        </div>
        {hasTabs ? (
          <div className="flex flex-wrap items-center gap-1 border-b border-border/70 bg-card/60 px-3 py-2">
            {tabs!.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTabId(tab.id)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  activeTab?.id === tab.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex-1 overflow-auto p-5">
          {hasTabs ? activeTab?.content : children}
        </div>
      </div>
    </div>
  );
}
