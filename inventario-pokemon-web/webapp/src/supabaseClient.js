import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.warn(
    "Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. " +
    "Configúralas en tu archivo .env (desarrollo) o en Vercel → Settings → Environment Variables (producción)."
  );
}

export const supabase = createClient(url || "", key || "");
