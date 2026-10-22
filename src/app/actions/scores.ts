"use server";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/authz";
import { friendlyDbError } from "@/lib/db-errors";
import { isSupabaseConfigured } from "@/lib/env";
import { getSession } from "@/lib/session";
import { createUserClient } from "@/lib/supabase/server";
import { formObject, scoreSchema, zodErrors, type ActionState } from "@/lib/validation";

async function authed() {
  requireActor((await getSession())?.actor);
  if (!isSupabaseConfigured()) throw new Error("not configured");
  return createUserClient();
}

/** All three actions call SQL functions that derive the user from the JWT (auth.uid()), never from a form field. */
export async function addScore(_p: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = scoreSchema.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
  const supabase = await authed();
  const { data, error } = await supabase.rpc("add_score", { p_date: parsed.data.scoreDate, p_value: parsed.data.value });
  if (error) return { ok: false, message: friendlyDbError(error.message) };
  revalidatePath("/app", "layout");
  const evicted = (data as { evicted: { score_date: string } | null } | null)?.evicted;
  return { ok: true, message: evicted ? `Score added. Your oldest score (${evicted.score_date}) was replaced.` : "Score added." };
}

export async function updateScore(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("id") ?? "");
  const parsed = scoreSchema.safeParse(formObject(fd));
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, message: "Score not found." };
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
  const supabase = await authed();
  const { error } = await supabase.rpc("update_score", { p_id: id, p_date: parsed.data.scoreDate, p_value: parsed.data.value });
  if (error) return { ok: false, message: friendlyDbError(error.message) };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Score updated." };
}

export async function deleteScore(fd: FormData): Promise<void> {
  const id = String(fd.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const supabase = await authed();
  await supabase.rpc("delete_score", { p_id: id });
  revalidatePath("/app", "layout");
}
