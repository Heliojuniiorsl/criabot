import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

import { AdminLayout } from "@/components/AdminLayout";
import { getAdminSession } from "@/lib/api/auth.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedRoute,
});

function AuthenticatedRoute() {
  const navigate = useNavigate();
  const sessionFn = useServerFn(getAdminSession);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void sessionFn().then((session) => {
      if (!session.authenticated) {
        void navigate({ to: "/" });
        return;
      }
      setReady(true);
    });
  }, [navigate, sessionFn]);

  if (!ready) return <div className="p-8 text-sm text-muted-foreground">Validando sessão...</div>;
  return (
    <AdminLayout>
      <Outlet />
    </AdminLayout>
  );
}
