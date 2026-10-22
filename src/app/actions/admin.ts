"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runPublish, runSimulation } from "@/lib/admin/draws";
import { AuthorizationError } from "@/lib/authz";
import { dbErrorCode, friendlyDbError } from "@/lib/db-errors";
import { requireAdminAction } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  charitySchema, drawCreateSchema, evidenceReviewSchema, formObject, payoutSchema, tierConfigSchema, zodErrors, type ActionState,
} from "@/lib/validation";

/** Runs an admin action: server-side authorisation first, then the work; errors become friendly messages. */
async function guarded<T extends ActionState | void>(fn: (actorId: string, db: ReturnType<typeof createAdminClient>) => Promise<T>): Promise<T | ActionState> {
  try {
    const { actor } = await requireAdminAction();
    return await fn(actor.id, createAdminClient());
  } catch (e) {
    if (e instanceof AuthorizationError) return { ok: false, message: "You don't have permission to do that." };
    const msg = (e as Error).message;
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    return { ok: false, message: dbErrorCode(msg) ? friendlyDbError(msg) : "That didn't work. Please try again." };
  }
}
const audit = (db: ReturnType<typeof createAdminClient>, actor: string, action: string, type: string, id: string, before: unknown, after: unknown, reason?: string) =>
  db.rpc("write_audit", { p_actor: actor, p_action: action, p_entity_type: type, p_entity_id: id, p_before: before ?? null, p_after: after ?? null, p_reason: reason ?? null });

/* ------------------------------- charities -------------------------------- */
export async function saveCharity(_p: ActionState, fd: FormData): Promise<ActionState> {
  return (await guarded(async (actor, db) => {
    const parsed = charitySchema.safeParse(formObject(fd));
    if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) } as ActionState;
    const id = String(fd.get("id") ?? "");
    const v = parsed.data;
    const row = { name: v.name, slug: v.slug, short_description: v.shortDescription || null, description: v.description || null, category: v.category || null, location: v.location || null, website_url: v.websiteUrl || null, image_url: v.imageUrl || null, image_alt: v.imageAlt || null, status: v.status, is_featured: !!v.isFeatured };
    const dup = await db.from("charities").select("id").eq("slug", v.slug).maybeSingle();
    if (dup.data && dup.data.id !== id) return { ok: false, errors: { slug: "That slug is already used by another charity." } } as ActionState;
    if (id) {
      const before = (await db.from("charities").select("*").eq("id", id).maybeSingle()).data;
      const { error } = await db.from("charities").update(row).eq("id", id);
      if (error) throw error;
      await audit(db, actor, "charity.updated", "charity", id, before, row);
      revalidatePath("/admin/charities");
      return { ok: true, message: "Charity saved." } as ActionState;
    }
    const { data, error } = await db.from("charities").insert({ ...row, created_by: actor }).select("id").single();
    if (error) throw error;
    await audit(db, actor, "charity.created", "charity", data.id, null, row);
    revalidatePath("/admin/charities");
    redirect(`/admin/charities/${data.id}`);
  })) as ActionState;
}

export async function archiveCharity(fd: FormData): Promise<void> {
  await guarded(async (actor, db) => {
    const id = String(fd.get("id") ?? "");
    const restore = fd.get("restore") === "true";
    await db.from("charities").update({ status: restore ? "active" : "archived", ...(restore ? {} : { is_featured: false }) }).eq("id", id);
    await audit(db, actor, restore ? "charity.restored" : "charity.archived", "charity", id, null, null);
    revalidatePath("/admin/charities");
  });
}

/* --------------------------------- users ---------------------------------- */
export async function setUserStatus(fd: FormData): Promise<void> {
  await guarded(async (actor, db) => {
    const id = String(fd.get("id") ?? "");
    const status = fd.get("status") === "suspended" ? "suspended" : "active";
    const reason = String(fd.get("reason") ?? "").trim().slice(0, 300);
    if (id === actor) return; // an admin can't lock themselves out
    const { error } = await db.from("profiles").update({ status }).eq("id", id);
    if (error) throw error;
    await audit(db, actor, `user.${status === "suspended" ? "suspended" : "reactivated"}`, "profile", id, null, { status }, reason || undefined);
    revalidatePath(`/admin/users/${id}`);
  });
}

/* ---------------------------------- draws --------------------------------- */
export async function createDraw(_p: ActionState, fd: FormData): Promise<ActionState> {
  return (await guarded(async (actor, db) => {
    const parsed = drawCreateSchema.safeParse(formObject(fd));
    if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) } as ActionState;
    const v = parsed.data;
    const { data: cfg } = await db.from("app_settings").select("value").eq("key", "tier_config").maybeSingle();
    const { data, error } = await db.from("draws").insert({
      title: v.title, period_month: `${v.periodMonth}-01`, eligibility_cutoff: `${v.cutoffDate}T23:59:59Z`,
      mode: v.mode, weight_bias: v.weightBias, weight_smoothing: v.weightSmoothing, tier_config: cfg?.value, created_by: actor,
    }).select("id").single();
    if (error) return { ok: false, message: error.message.includes("draws_one_per_month") ? "A draw already exists for that month." : "Couldn't create the draw." } as ActionState;
    await audit(db, actor, "draw.created", "draw", data.id, null, v);
    redirect(`/admin/draws/${data.id}`);
  })) as ActionState;
}

const idOf = (fd: FormData) => z.string().uuid().parse(String(fd.get("id") ?? ""));

export async function simulateDrawAction(fd: FormData): Promise<void> {
  await guarded(async (actor, db) => { await runSimulation(db, idOf(fd), actor); revalidatePath(`/admin/draws/${idOf(fd)}`); });
}
export async function approveDrawAction(fd: FormData): Promise<void> {
  await guarded(async (actor, db) => {
    const { error } = await db.rpc("approve_draw", { p_draw: idOf(fd), p_actor: actor });
    if (error) throw error;
    revalidatePath(`/admin/draws/${idOf(fd)}`);
  });
}
export async function unapproveDrawAction(fd: FormData): Promise<void> {
  await guarded(async (actor, db) => {
    const { error } = await db.rpc("unapprove_draw", { p_draw: idOf(fd), p_actor: actor, p_reason: String(fd.get("reason") ?? "") });
    if (error) throw error;
    revalidatePath(`/admin/draws/${idOf(fd)}`);
  });
}
export async function publishDrawAction(fd: FormData): Promise<void> {
  await guarded(async (actor, db) => {
    if (String(fd.get("confirm") ?? "").trim().toUpperCase() !== "PUBLISH") throw new Error("REASON_REQUIRED: type PUBLISH to confirm");
    await runPublish(db, idOf(fd), actor);
    revalidatePath("/admin", "layout");
    revalidatePath("/app", "layout");
  });
}
export async function cancelDrawAction(fd: FormData): Promise<void> {
  await guarded(async (actor, db) => {
    const id = idOf(fd);
    const { error } = await db.from("draws").update({ status: "cancelled" }).eq("id", id);
    if (error) throw error;
    await audit(db, actor, "draw.cancelled", "draw", id, null, null, String(fd.get("reason") ?? "") || undefined);
    revalidatePath("/admin/draws");
  });
}

/* ------------------------- evidence review and payouts -------------------- */
export async function reviewEvidenceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return (await guarded(async (actor, db) => {
    const parsed = evidenceReviewSchema.safeParse(formObject(fd));
    if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) } as ActionState;
    const { error } = await db.rpc("review_evidence", { p_evidence: parsed.data.evidenceId, p_actor: actor, p_approve: parsed.data.decision === "approve", p_reason: parsed.data.reason || null });
    if (error) throw error;
    revalidatePath("/admin/winners", "layout");
    return { ok: true, message: parsed.data.decision === "approve" ? "Approved." : "Rejected. The winner has been notified." } as ActionState;
  })) as ActionState;
}
export async function queuePayoutAction(fd: FormData): Promise<void> {
  await guarded(async (actor, db) => {
    const { error } = await db.rpc("queue_payout", { p_winning: z.string().uuid().parse(String(fd.get("winningId"))), p_actor: actor });
    if (error) throw error;
    revalidatePath("/admin/winners", "layout"); revalidatePath("/admin/payouts");
  });
}
export async function markPaidAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return (await guarded(async (actor, db) => {
    const parsed = payoutSchema.safeParse(formObject(fd));
    if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) } as ActionState;
    const { error } = await db.rpc("mark_payout_paid", { p_winning: parsed.data.winningId, p_actor: actor, p_reference: parsed.data.reference, p_method: parsed.data.method || null, p_notes: parsed.data.notes || null });
    if (error) throw error;
    revalidatePath("/admin/payouts"); revalidatePath("/admin/winners", "layout");
    return { ok: true, message: "Recorded as paid." } as ActionState;
  })) as ActionState;
}

/* --------------------------------- settings ------------------------------- */
const settingsSchema = z.object({
  prizePoolBps: z.coerce.number().int().min(0).max(9000, "Prize pool can't take more than 90% of a payment."),
  confirmed: z.coerce.boolean().optional(),
  monthlyPrice: z.coerce.number().int().min(100, "Minimum ₹1.").max(10_000_000),
  yearlyPrice: z.coerce.number().int().min(100).max(100_000_000),
});
export async function saveSettings(_p: ActionState, fd: FormData): Promise<ActionState> {
  return (await guarded(async (actor, db) => {
    const parsed = settingsSchema.safeParse({ ...formObject(fd), confirmed: fd.get("confirmed") === "on" });
    if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) } as ActionState;
    const tier = tierConfigSchema.safeParse({ s5: fd.get("s5"), s4: fd.get("s4"), s3: fd.get("s3"), unclaimedPolicy: fd.get("unclaimedPolicy") });
    if (!tier.success) return { ok: false, message: tier.error.issues[0].message } as ActionState;
    const { data: minRow } = await db.from("app_settings").select("value").eq("key", "min_charity_bps").maybeSingle();
    if (parsed.data.prizePoolBps + Number(minRow?.value ?? 1000) > 10000) return { ok: false, errors: { prizePoolBps: "Prize pool plus the minimum charity share can't exceed 100%." } } as ActionState;
    const { data: before } = await db.from("app_settings").select("key, value");
    const now = new Date().toISOString();
    const tierValue = { shareBps: { 5: tier.data.s5, 4: tier.data.s4, 3: tier.data.s3 }, rollover: { 5: true, 4: false, 3: false }, unclaimedPolicy: tier.data.unclaimedPolicy };
    const up = await db.from("app_settings").upsert([
      { key: "prize_pool_bps", value: parsed.data.prizePoolBps, is_public: true, updated_by: actor, updated_at: now },
      { key: "prize_pool_confirmed", value: !!parsed.data.confirmed, is_public: false, updated_by: actor, updated_at: now },
      { key: "tier_config", value: tierValue, is_public: true, updated_by: actor, updated_at: now },
    ]);
    if (up.error) throw up.error;
    await db.from("plans").update({ amount_minor: parsed.data.monthlyPrice * 100, updated_at: now }).eq("id", "monthly");
    await db.from("plans").update({ amount_minor: parsed.data.yearlyPrice * 100, updated_at: now }).eq("id", "yearly");
    await audit(db, actor, "settings.updated", "settings", "app", before, { ...parsed.data, tierValue });
    revalidatePath("/admin/settings");
    return { ok: true, message: "Settings saved. New prices apply to new checkouts; existing subscribers keep their current Stripe price. Tier changes apply to draws created from now on." } as ActionState;
  })) as ActionState;
}
