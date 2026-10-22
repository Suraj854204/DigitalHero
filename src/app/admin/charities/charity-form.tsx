"use client";
import { useActionState } from "react";
import { saveCharity } from "@/app/actions/admin";
import { FormMessage } from "@/components/ui/form-message";
import { Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

export interface CharityFormValues { id?: string; name?: string; slug?: string; short_description?: string | null; description?: string | null; category?: string | null; location?: string | null; website_url?: string | null; image_url?: string | null; image_alt?: string | null; status?: string; is_featured?: boolean }

export function CharityAdminForm({ v = {} }: { v?: CharityFormValues }) {
  const [state, action] = useActionState(saveCharity, { ok: false });
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage state={state} />
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name" name="name" error={e.name}><Input name="name" defaultValue={v.name} required invalid={!!e.name} /></Field>
        <Field label="Slug (URL)" name="slug" error={e.slug} hint="lowercase-with-hyphens, must be unique"><Input name="slug" defaultValue={v.slug} required invalid={!!e.slug} /></Field>
        <Field label="Category" name="category" error={e.category}><Input name="category" defaultValue={v.category ?? ""} /></Field>
        <Field label="Location" name="location" error={e.location}><Input name="location" defaultValue={v.location ?? ""} /></Field>
      </div>
      <Field label="Short description (max 240 chars)" name="shortDescription" error={e.shortDescription}><Input name="shortDescription" defaultValue={v.short_description ?? ""} maxLength={240} /></Field>
      <Field label="Full description" name="description" error={e.description} hint="Only verified information. Separate paragraphs with a blank line."><Textarea name="description" defaultValue={v.description ?? ""} rows={8} /></Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Website" name="websiteUrl" error={e.websiteUrl}><Input name="websiteUrl" type="url" defaultValue={v.website_url ?? ""} /></Field>
        <Field label="Image URL (licensed)" name="imageUrl" error={e.imageUrl} hint="Optional. Leave empty to use generated artwork."><Input name="imageUrl" type="url" defaultValue={v.image_url ?? ""} /></Field>
        <Field label="Image alt text" name="imageAlt"><Input name="imageAlt" defaultValue={v.image_alt ?? ""} /></Field>
        <Field label="Status" name="status"><Select name="status" defaultValue={v.status ?? "active"}><option value="active">Active (visible)</option><option value="inactive">Inactive (hidden)</option><option value="archived">Archived</option></Select></Field>
      </div>
      <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" name="isFeatured" defaultChecked={v.is_featured} className="size-4 accent-[var(--color-forest)]" /> Feature on the homepage</label>
      <SubmitButton pendingText="Saving…">Save charity</SubmitButton>
    </form>
  );
}
