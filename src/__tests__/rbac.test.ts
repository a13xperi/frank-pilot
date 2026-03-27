/**
 * Tests for src/middleware/rbac.ts — pure function layer
 *
 * Covers separation-of-duties enforcement and role hierarchy checks.
 * These functions have no database dependencies and can be tested in isolation.
 *
 * Compliance note: Separation of duties is a core HUD/LIHTC and internal
 * control requirement — no single person may submit AND approve an application.
 */

import {
  enforceSeparationOfDuties,
  meetsMinimumRole,
  PERMISSIONS,
  ROLE_HIERARCHY,
} from "../middleware/rbac";

describe("enforceSeparationOfDuties", () => {
  it("returns true when actor has not previously acted", () => {
    expect(enforceSeparationOfDuties("user-C", ["user-A", "user-B"])).toBe(true);
  });

  it("returns false when actor is the original submitter", () => {
    expect(enforceSeparationOfDuties("user-A", ["user-A", "user-B"])).toBe(false);
  });

  it("returns false when actor previously approved a tier", () => {
    expect(enforceSeparationOfDuties("user-B", ["user-A", "user-B"])).toBe(false);
  });

  it("returns true when the previous actors list is empty", () => {
    expect(enforceSeparationOfDuties("user-A", [])).toBe(true);
  });

  it("is case-sensitive (different casing = different actor)", () => {
    expect(enforceSeparationOfDuties("User-A", ["user-a"])).toBe(true);
  });
});

describe("meetsMinimumRole", () => {
  it("leasing_agent does not meet senior_manager minimum", () => {
    expect(meetsMinimumRole("leasing_agent", "senior_manager")).toBe(false);
  });

  it("senior_manager meets senior_manager minimum (equal)", () => {
    expect(meetsMinimumRole("senior_manager", "senior_manager")).toBe(true);
  });

  it("regional_manager meets senior_manager minimum (higher)", () => {
    expect(meetsMinimumRole("regional_manager", "senior_manager")).toBe(true);
  });

  it("system_admin meets every role minimum", () => {
    for (const role of Object.keys(ROLE_HIERARCHY)) {
      expect(meetsMinimumRole("system_admin", role)).toBe(true);
    }
  });

  it("leasing_agent meets leasing_agent minimum (self)", () => {
    expect(meetsMinimumRole("leasing_agent", "leasing_agent")).toBe(true);
  });

  it("asset_manager does not meet system_admin minimum", () => {
    expect(meetsMinimumRole("asset_manager", "system_admin")).toBe(false);
  });

  it("unknown role returns false for any minimum", () => {
    expect(meetsMinimumRole("hacker", "leasing_agent")).toBe(false);
  });
});

describe("ROLE_HIERARCHY ordering", () => {
  it("leasing_agent < senior_manager < regional_manager < asset_manager < system_admin", () => {
    expect(ROLE_HIERARCHY["leasing_agent"]).toBeLessThan(ROLE_HIERARCHY["senior_manager"]);
    expect(ROLE_HIERARCHY["senior_manager"]).toBeLessThan(ROLE_HIERARCHY["regional_manager"]);
    expect(ROLE_HIERARCHY["regional_manager"]).toBeLessThan(ROLE_HIERARCHY["asset_manager"]);
    expect(ROLE_HIERARCHY["asset_manager"]).toBeLessThan(ROLE_HIERARCHY["system_admin"]);
  });
});

describe("PERMISSIONS matrix — access control invariants", () => {
  it("leasing_agent cannot initiate screening", () => {
    expect(PERMISSIONS["screening:initiate"]).not.toContain("leasing_agent");
  });

  it("leasing_agent cannot approve any tier", () => {
    expect(PERMISSIONS["approval:tier1"]).not.toContain("leasing_agent");
    expect(PERMISSIONS["approval:tier2"]).not.toContain("leasing_agent");
    expect(PERMISSIONS["approval:tier3"]).not.toContain("leasing_agent");
  });

  it("only system_admin can manage users", () => {
    expect(PERMISSIONS["user:manage"]).toEqual(["system_admin"]);
  });

  it("regional_manager and above can resolve fraud flags", () => {
    const allowed = PERMISSIONS["fraud:resolve"];
    expect(allowed).toContain("regional_manager");
    expect(allowed).toContain("asset_manager");
    expect(allowed).toContain("system_admin");
    expect(allowed).not.toContain("leasing_agent");
    expect(allowed).not.toContain("senior_manager");
  });

  it("only asset_manager and system_admin can approve tier3", () => {
    const allowed = PERMISSIONS["approval:tier3"];
    expect(allowed).toContain("asset_manager");
    expect(allowed).toContain("system_admin");
    expect(allowed).not.toContain("regional_manager");
    expect(allowed).not.toContain("senior_manager");
    expect(allowed).not.toContain("leasing_agent");
  });

  it("all roles can create and read applications", () => {
    const createAllowed = PERMISSIONS["application:create"];
    const readAllowed = PERMISSIONS["application:read"];
    for (const role of Object.keys(ROLE_HIERARCHY)) {
      expect(createAllowed).toContain(role);
      expect(readAllowed).toContain(role);
    }
  });

  it("audit:view is restricted to regional_manager and above", () => {
    const allowed = PERMISSIONS["audit:view"];
    expect(allowed).not.toContain("leasing_agent");
    expect(allowed).not.toContain("senior_manager");
    expect(allowed).toContain("regional_manager");
    expect(allowed).toContain("asset_manager");
    expect(allowed).toContain("system_admin");
  });
});
