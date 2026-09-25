"use client";

import { call } from "./auth-client";
import type { Member, InviteInput, MemberPatch } from "./auth/team";
import type { DistrictsView, DistrictView } from "./auth/districts";

/** Thin fetch wrappers for the team and districts API, mirroring auth-client. */

export type { Member, InviteInput, MemberPatch, DistrictsView, DistrictView };

const json = (body: unknown) => JSON.stringify(body);

export const teamApi = {
  list: () => call<{ members: Member[] }>("/api/team", { method: "GET" }),
  invite: (data: InviteInput) => call<Member>("/api/team", { method: "POST", body: json(data) }),
  update: (userId: string, patch: MemberPatch) =>
    call<Member>(`/api/team/${userId}`, { method: "PATCH", body: json(patch) }),
  deactivate: (userId: string) => call<Member>(`/api/team/${userId}/deactivate`, { method: "POST", body: "{}" }),
  resendInvite: (userId: string) => call<Member>(`/api/team/${userId}/invite`, { method: "POST", body: "{}" }),
  revokeInvite: (userId: string) => call<{ id: string }>(`/api/team/${userId}/invite`, { method: "DELETE" }),
};

export const districtsApi = {
  list: () => call<DistrictsView>("/api/districts", { method: "GET" }),
  create: (name: string) => call<DistrictView>("/api/districts", { method: "POST", body: json({ name }) }),
  update: (id: string, patch: { name?: string; locationIds?: string[] }) =>
    call<DistrictView>(`/api/districts/${id}`, { method: "PATCH", body: json(patch) }),
  remove: (id: string) => call<{ id: string; orphanedLocations: number }>(`/api/districts/${id}`, { method: "DELETE" }),
};
