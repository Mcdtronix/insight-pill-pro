import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/")({
  ssr: false,
  component: Index,
});

function Index() {
  const { status } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (status === "loading") return;
    navigate({ to: status === "authenticated" ? "/dashboard" : "/login", replace: true });
  }, [status, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Loading Pharma DSS…</p>
    </div>
  );
}
