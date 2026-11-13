import { describe, expect, it } from "vitest";
import { BACKUP_STALE_AFTER_H, backupHealth, formatAge, parseBackupRow } from "./backupHealth";

const NOW = new Date("2026-11-13T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe("parseBackupRow", () => {
  it("no row → none (table exists, nothing reported yet)", () => {
    expect(parseBackupRow(null)).toEqual({ kind: "none" });
  });
  it("reads the job's heartbeat fields", () => {
    expect(parseBackupRow({ updated_at: "2026-11-13T05:00:00Z", value: { file: "backup-13.json", projects: 6, bytes: 1571894 } }))
      .toEqual({ kind: "ok", status: { updatedAt: "2026-11-13T05:00:00Z", file: "backup-13.json", projects: 6, bytes: 1571894 } });
  });
  it("ignores wrongly-typed fields instead of trusting them", () => {
    const r = parseBackupRow({ updated_at: "2026-11-13T05:00:00Z", value: { file: 7, projects: "6", bytes: null } });
    expect(r).toEqual({ kind: "ok", status: { updatedAt: "2026-11-13T05:00:00Z", file: undefined, projects: undefined, bytes: undefined } });
  });
  it("a row without a timestamp is an error, not 'fresh'", () => {
    expect(parseBackupRow({ value: {} }).kind).toBe("error");
  });
});

describe("formatAge", () => {
  it("reads naturally at each scale", () => {
    expect(formatAge(0.4)).toBe("just now");
    expect(formatAge(5.9)).toBe("5 h ago");
    expect(formatAge(47.9)).toBe("47 h ago");
    expect(formatAge(24 * 43)).toBe("43 days ago");
  });
});

describe("backupHealth", () => {
  it("a recent backup is ok, with facts in the tooltip", () => {
    const h = backupHealth({ kind: "ok", status: { updatedAt: hoursAgo(7), file: "backup-13.json", projects: 6, bytes: 1_571_894 } }, NOW);
    expect(h.level).toBe("ok");
    expect(h.label).toBe("Backup: 7 h ago");
    expect(h.detail).toContain("backup-13.json");
    expect(h.detail).toContain("6 projects");
    expect(h.detail).toContain("1.6 MB");
  });

  it("one missed night is still ok; past the threshold it is stale", () => {
    expect(backupHealth({ kind: "ok", status: { updatedAt: hoursAgo(BACKUP_STALE_AFTER_H - 1) } }, NOW).level).toBe("ok");
    const s = backupHealth({ kind: "ok", status: { updatedAt: hoursAgo(BACKUP_STALE_AFTER_H + 1) } }, NOW);
    expect(s.level).toBe("stale");
    expect(s.label).toContain("⚠");
    expect(s.detail).toMatch(/STOPPED/);
  });

  it("the real 2026 incident (43 days) reads as stale in days", () => {
    const s = backupHealth({ kind: "ok", status: { updatedAt: "2026-10-01T19:25:00Z" } }, NOW);
    expect(s.level).toBe("stale");
    expect(s.label).toBe("Backup: 42 days ago ⚠");
  });

  it("nothing reported yet → missing", () => {
    expect(backupHealth({ kind: "none" }, NOW).level).toBe("missing");
  });

  it("read error (e.g. schema.sql not re-run) → unknown, and says how to fix it", () => {
    const u = backupHealth({ kind: "error", message: "Could not find the table 'public.system_status'" }, NOW);
    expect(u.level).toBe("unknown");
    expect(u.detail).toContain("schema.sql");
  });

  it("clock skew (heartbeat slightly in the future) never shows a negative age", () => {
    const h = backupHealth({ kind: "ok", status: { updatedAt: new Date(NOW.getTime() + 60_000).toISOString() } }, NOW);
    expect(h).toMatchObject({ level: "ok", label: "Backup: just now", ageHours: 0 });
  });

  it("an unparseable timestamp is unknown, never ok", () => {
    expect(backupHealth({ kind: "ok", status: { updatedAt: "yesterday-ish" } }, NOW).level).toBe("unknown");
  });
});
