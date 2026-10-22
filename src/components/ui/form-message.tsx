import { Alert } from "./primitives";
import type { ActionState } from "@/lib/validation";

export function FormMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>;
}
