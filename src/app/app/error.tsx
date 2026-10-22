"use client";
import { Alert } from "@/components/ui/primitives";
import { buttonClass } from "@/components/ui/button-styles";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-4"><Alert tone="error">We couldn't load this page. Nothing was changed.{error.digest && <span className="ml-2 font-mono text-xs">Ref: {error.digest}</span>}</Alert>
      <button className={buttonClass("secondary", "sm")} onClick={reset}>Try again</button></div>
  );
}
