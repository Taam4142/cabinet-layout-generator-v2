/**
 * Backup health for the admin-only toolbar chip (RISK_REVIEW R4-1).
 *
 * The nightly backup job (.github/workflows/backup.yml) writes a heartbeat row
 * `system_status{key:"backup"}` = { file, projects, bytes } + updated_at after a
 * successful upload. This pure module turns that row (or its absence / a read
 * error) into what the chip shows, so a stopped backup — for ANY reason: GitHub
 * disabled the schedule, a secret expired, the job is failing — is visible the
 * next time an admin opens the app. No DOM, unit-tested.
 */

/** The job runs daily (~02:23 Bangkok); one missed night is tolerated, two is a problem. */
export const BACKUP_STALE_AFTER_H = 48;

/** Where an admin goes to check / re-run the backup. (Update on a repo rename.) */
export const BACKUP_ACTIONS_URL =
  "https://github.com/Taam4142/cabinet-layout-generator-v2/actions/workflows/backup.yml";

export interface BackupStatus {
  updatedAt: string; // ISO timestamp the heartbeat was written
  file?: string; // e.g. backup-13.json
  projects?: number;
  bytes?: number;
}

/** Result of reading the heartbeat row. */
export type BackupLoad =
  | { kind: "ok"; status: BackupStatus }
  | { kind: "none" } // table exists, no backup has reported yet
  | { kind: "error"; message: string }; // e.g. table missing (schema.sql not re-run), network

export type BackupLevel = "ok" | "stale" | "missing" | "unknown";

export interface BackupHealth {
  level: BackupLevel;
  /** short chip text */
  label: string;
  /** tooltip: what it means + what to do */
  detail: string;
  ageHours: number | null;
}

/** Defensive parse of a `system_status` row (value is jsonb written by the job). */
export function parseBackupRow(row: { value?: unknown; updated_at?: unknown } | null): BackupLoad {
  if (!row) return { kind: "none" };
  if (typeof row.updated_at !== "string") return { kind: "error", message: "heartbeat row has no timestamp" };
  const v = (row.value && typeof row.value === "object" ? row.value : {}) as Record<string, unknown>;
  return {
    kind: "ok",
    status: {
      updatedAt: row.updated_at,
      file: typeof v.file === "string" ? v.file : undefined,
      projects: typeof v.projects === "number" ? v.projects : undefined,
      bytes: typeof v.bytes === "number" ? v.bytes : undefined,
    },
  };
}

/** "just now" · "5 h ago" · "3 days ago" */
export function formatAge(hours: number): string {
  if (hours < 1) return "just now";
  if (hours < 48) return `${Math.floor(hours)} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function sizeText(bytes?: number): string {
  if (bytes === undefined) return "";
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

const FIX = "Open GitHub → Actions → Nightly backup to check it and run it (click this chip).";

export function backupHealth(load: BackupLoad, now: Date = new Date()): BackupHealth {
  if (load.kind === "error") {
    return {
      level: "unknown",
      label: "Backup: unknown",
      detail:
        `Couldn't read the backup status (${load.message}). If supabase/schema.sql hasn't been ` +
        `re-run since the backup-status table was added, re-run it once. ${FIX}`,
      ageHours: null,
    };
  }
  if (load.kind === "none") {
    return {
      level: "missing",
      label: "Backup: none yet",
      detail: `No backup has reported in yet. The nightly job reports after each successful run. ${FIX}`,
      ageHours: null,
    };
  }
  const t = Date.parse(load.status.updatedAt);
  if (Number.isNaN(t)) {
    return { level: "unknown", label: "Backup: unknown", detail: `The backup heartbeat has an unreadable time. ${FIX}`, ageHours: null };
  }
  const ageHours = Math.max(0, (now.getTime() - t) / 3_600_000); // clock skew → never negative
  const { file, projects, bytes } = load.status;
  const facts = [
    `Last backup ${new Date(t).toLocaleString()}`,
    file && `file ${file}`,
    projects !== undefined && `${projects} project${projects === 1 ? "" : "s"}`,
    sizeText(bytes),
  ].filter(Boolean).join(" · ");
  if (ageHours > BACKUP_STALE_AFTER_H) {
    return {
      level: "stale",
      label: `Backup: ${formatAge(ageHours)} ⚠`,
      detail: `${facts}. Nightly backups seem to have STOPPED (expected daily). ${FIX}`,
      ageHours,
    };
  }
  return { level: "ok", label: `Backup: ${formatAge(ageHours)}`, detail: `${facts}. Nightly backups are running.`, ageHours };
}
