import type { SkillGrant, SkillIndexPackage } from "~/domain/types";

export function skillPermissionsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const set = new Set(a);
  return b.every((p) => set.has(p));
}

export function skillGrantFor(
  grants: SkillGrant[],
  pkg: Pick<SkillIndexPackage, "id" | "commit">,
): SkillGrant | undefined {
  return grants.find((g) => g.id === pkg.id && g.commit === pkg.commit);
}

export function permissionsConfirmed(
  grants: SkillGrant[],
  pkg: SkillIndexPackage,
): boolean {
  const grant = skillGrantFor(grants, pkg);
  return Boolean(grant && skillPermissionsMatch(grant.permissions, pkg.permissions));
}

export function upsertSkillGrant(grants: SkillGrant[], pkg: SkillIndexPackage): SkillGrant[] {
  const filtered = grants.filter((g) => !(g.id === pkg.id && g.commit === pkg.commit));
  return [
    ...filtered,
    {
      id: pkg.id,
      commit: pkg.commit,
      permissions: [...pkg.permissions],
    },
  ];
}

export function removeSkillGrantsForId(grants: SkillGrant[], skillId: string): SkillGrant[] {
  return grants.filter((g) => g.id !== skillId);
}
