"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { evidencePathBelongsTo, requireActor } from "@/lib/authz";
import { friendlyDbError } from "@/lib/db-errors";
import { sniffImage } from "@/lib/image-sniff";
import { getSession } from "@/lib/session";
import { createUserClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/validation";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function submitEvidence(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = requireActor((await getSession())?.actor);
  const winningId = String(fd.get("winningId") ?? "");
  const file = fd.get("file");
  if (!/^[0-9a-f-]{36}$/i.test(winningId)) return { ok: false, message: "Winning not found." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, errors: { file: "Choose a screenshot to upload." } };
  if (file.size > MAX_BYTES) return { ok: false, errors: { file: "That file is larger than 5 MB." } };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImage(bytes);
  if (!mime || !TYPES[mime]) return { ok: false, errors: { file: "Please upload a PNG, JPEG or WebP image." } };

  const path = `${actor.id}/${winningId}/${randomUUID()}.${TYPES[mime]}`;
  if (!evidencePathBelongsTo(path, actor.id)) return { ok: false, message: "Invalid upload path." };

  const supabase = await createUserClient();
  // RLS on the winnings row guarantees this is the caller's own winning before we store anything.
  const { data: w } = await supabase.from("winnings").select("id, claim_status").eq("id", winningId).maybeSingle();
  if (!w) return { ok: false, message: "Winning not found." };
  if (!["not_submitted", "rejected"].includes(w.claim_status)) return { ok: false, message: "Evidence can't be submitted at this stage." };

  const up = await supabase.storage.from("winner-evidence").upload(path, bytes, { contentType: mime, upsert: false });
  if (up.error) return { ok: false, message: "We couldn't upload your file. Please try again." };
  const { error } = await supabase.rpc("submit_evidence", { p_winning: winningId, p_path: path, p_mime: mime, p_size: file.size });
  if (error) {
    await supabase.storage.from("winner-evidence").remove([path]); // don't leave an orphan behind
    return { ok: false, message: friendlyDbError(error.message) };
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: "Thanks! Your proof is with our team for review." };
}
