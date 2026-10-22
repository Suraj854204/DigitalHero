"use client";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/cn";
import { buttonClass, type ButtonVariant } from "./button-styles";

export function SubmitButton({
  children,
  pendingText = "Working…",
  variant = "primary",
  className,
  size = "md",
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: ButtonVariant;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={pending} className={cn(buttonClass(variant, size), className)}>
      {pending ? (
        <>
          <span aria-hidden className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <span>{pendingText}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
