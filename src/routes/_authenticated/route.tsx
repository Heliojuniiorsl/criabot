import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AdminLayout } from "@/components/AdminLayout";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedRoute,
});

function AuthenticatedRoute() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        void navigate({ to: "/" });
        return;
      }
      setReady(true);
    });
  }, [navigate]);

  if (!ready) return <div className="p-8 text-sm text-muted-foreground">Validando sessão...</div>;
  return (
    <AdminLayout>
      <Outlet />
    </AdminLayout>
  );
}
