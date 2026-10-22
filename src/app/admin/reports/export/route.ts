import { NextResponse, type NextRequest } from "next/server";
import { getReport, isReportType } from "@/lib/admin/reports";
import { toCsv } from "@/lib/format";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.profile.role !== "admin" || session.profile.status !== "active") return new NextResponse("Not found", { status: 404 });
  const p = req.nextUrl.searchParams;
  const type = p.get("type") ?? "";
  const from = p.get("from") ?? "";
  const to = p.get("to") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (!isReportType(type) || !date.test(from) || !date.test(to)) return new NextResponse("Bad request", { status: 400 });
  const csv = toCsv(await getReport(type, from, to));
  return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${type}-${from}-to-${to}.csv"`, "cache-control": "no-store" } });
}
