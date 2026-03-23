import { Badge } from "@/components/ui/badge";

const hasCepHost = typeof window !== "undefined" && "__adobe_cep__" in window;

const Index = () => {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <section className="w-full max-w-2xl rounded-2xl border bg-card p-8 shadow-sm">
        <Badge className="mb-4" variant="secondary">
          {hasCepHost ? "Connected to CEP host" : "Running outside Premiere"}
        </Badge>
        <h1 className="mb-3 text-3xl font-semibold tracking-tight">
          Sora Genie
        </h1>
        <p className="mb-6 text-base text-muted-foreground">
          This build is packaged as an Adobe CEP panel so it can appear in
          Premiere Pro under the Extensions menu.
        </p>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            Install with <code>npm run install:premiere</code> after dependencies
            are installed.
          </p>
          <p>
            If the panel still does not appear, restart Premiere Pro after the
            installer enables CEP debug mode and copies the extension bundle.
          </p>
        </div>
      </section>
    </main>
  );
};

export default Index;
