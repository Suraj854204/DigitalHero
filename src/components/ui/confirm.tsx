"use client";
import { useRef } from "react";
import { cn } from "@/lib/cn";
import { buttonClass, type ButtonVariant } from "./button-styles";
import { SubmitButton } from "./submit-button";

/**
 * Confirmation dialog around a server action. Uses the native <dialog> element (focus trap,
 * Escape to close, accessible by default). The confirming button is the form's submit button, so
 * the action runs on the server; there is no client-only state that could be spoofed.
 */
export function ConfirmForm({
  action,
  trigger,
  title,
  description,
  confirmLabel,
  variant = "primary",
  triggerVariant = "secondary",
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  trigger: string;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  variant?: ButtonVariant;
  triggerVariant?: ButtonVariant;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className={buttonClass(triggerVariant, "sm")} onClick={() => ref.current?.showModal()}>
        {trigger}
      </button>
      <dialog ref={ref} aria-labelledby="confirm-title" className={cn("m-auto w-[min(92vw,30rem)] rounded-[var(--radius-lg)] border border-line bg-card p-0 text-ink shadow-lift backdrop:bg-ink/50 backdrop:backdrop-blur-sm")}>
        <form action={action} className="space-y-4 p-6">
          <h2 id="confirm-title" className="text-xl font-bold">{title}</h2>
          <div className="text-sm leading-relaxed text-ink-2">{description}</div>
          {children}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className={buttonClass("ghost", "sm")} onClick={() => ref.current?.close()}>Cancel</button>
            <SubmitButton variant={variant} size="sm">{confirmLabel}</SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
