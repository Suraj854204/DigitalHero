import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "coral";

export function buttonClass(variant: ButtonVariant = "primary", size: "sm" | "md" | "lg" = "md") {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition duration-200 select-none",
    "disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.98]",
    size === "sm" && "px-4 py-2 text-sm",
    size === "md" && "px-6 py-3 text-[0.95rem]",
    size === "lg" && "px-8 py-4 text-base",
    variant === "primary" && "bg-forest text-white shadow-soft hover:bg-forest-2",
    variant === "coral" && "bg-coral text-white shadow-soft hover:brightness-95",
    variant === "secondary" && "border border-ink/20 bg-card text-ink hover:border-ink/50",
    variant === "ghost" && "text-ink-2 hover:bg-paper-2",
    variant === "danger" && "bg-danger text-white hover:brightness-95",
  );
}
