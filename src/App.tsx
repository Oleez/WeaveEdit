import { Component, ErrorInfo, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Route, Routes } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const message = `${error.name}: ${error.message}\n${error.stack ?? ""}\n${errorInfo.componentStack}`;
    console.error("Weave Edit UI crashed", error, errorInfo);

    try {
      window.localStorage.setItem("weave-edit-last-ui-error", message);
    } catch {
      // Ignore storage failures; the visible fallback is the important part.
    }
  }

  render() {
    if (this.state.error) {
      return (
        <main style={{ minHeight: "100vh", background: "#0b1020", color: "#f8fafc", padding: 32 }}>
          <section style={{ maxWidth: 780, margin: "0 auto", fontFamily: "Arial, sans-serif" }}>
            <p style={{ color: "#93c5fd", letterSpacing: "0.16em", textTransform: "uppercase", fontSize: 12 }}>
              Weave Edit
            </p>
            <h1 style={{ fontSize: 32, margin: "12px 0" }}>The panel hit a UI error.</h1>
            <p style={{ color: "#cbd5e1", lineHeight: 1.6 }}>
              Restart Premiere and reopen the panel. If this message stays visible, send the error below.
            </p>
            <pre
              style={{
                marginTop: 20,
                padding: 16,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                border: "1px solid #334155",
                borderRadius: 12,
                background: "#020617",
                color: "#fca5a5",
              }}
            >
              {this.state.error.message}
            </pre>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

const App = () => (
  <AppErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  </AppErrorBoundary>
);

export default App;
