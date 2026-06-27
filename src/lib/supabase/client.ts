import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.types";

let browserClient: SupabaseClient<Database> | null | undefined;

export function createClient() {
  if (browserClient !== undefined) {
    return browserClient;
  }

  const config = getSupabaseConfig();
  if (!config) {
    browserClient = null;
    return browserClient;
  }

  browserClient = createBrowserClient<Database>(
    config.url,
    config.publishableKey,
  );
  return browserClient;
}
