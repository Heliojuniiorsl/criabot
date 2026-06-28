import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

import { PainelLayout } from "@/components/PainelLayout";

export const Route = createFileRoute("/_authenticated/painel")({
  component: PainelRoute,
});

function PainelRoute() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    if (pathname === "/painel") {
      void navigate({ to: "/painel/dashboard", replace: true });
    }
  }, [navigate, pathname]);

  return (
    <PainelLayout>
      <Outlet />
    </PainelLayout>
  );
}
