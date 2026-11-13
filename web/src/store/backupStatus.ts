/**
 * Backup heartbeat (Supabase `system_status`, key "backup") + the hook that keeps
 * the admin-only toolbar chip current (RISK_REVIEW R4-1). The row is written by
 * the nightly backup job with the service role; members can only read it.
 * Interpretation lives in the pure, tested lib/backupHealth.ts.
 */
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { backupHealth, parseBackupRow, type BackupHealth, type BackupLoad } from "../lib/backupHealth";

export async function loadBackupStatus(): Promise<BackupLoad> {
  if (!supabase) return { kind: "error", message: "cloud not configured" };
  try {
    const { data, error } = await supabase
      .from("system_status")
      .select("value,updated_at")
      .eq("key", "backup")
      .maybeSingle();
    if (error) return { kind: "error", message: error.message };
    return parseBackupRow(data);
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Re-read when the tab regains focus (e.g. back from re-running it on GitHub) and every 30 min. */
const REFRESH_MS = 30 * 60_000;

/**
 * Backup health for the toolbar chip, or null when it shouldn't show
 * (not an admin / no cloud) — members never see it.
 */
export function useBackupHealth(enabled: boolean): BackupHealth | null {
  const [load, setLoad] = useState<BackupLoad | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const refresh = async () => {
      const r = await loadBackupStatus();
      if (alive) { setLoad(r); setNow(new Date()); }
    };
    refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    const t = setInterval(refresh, REFRESH_MS);
    return () => { alive = false; window.removeEventListener("focus", onFocus); clearInterval(t); };
  }, [enabled]);

  if (!enabled || !load) return null;
  return backupHealth(load, now);
}
