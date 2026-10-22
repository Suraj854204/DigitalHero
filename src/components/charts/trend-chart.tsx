"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Single-series bar chart with an accessible text alternative (the table below it carries the same data). */
export function TrendChart({ data, label }: { data: { month: string; value: number }[]; label: string }) {
  if (data.length === 0) return <p className="text-sm text-muted">Not enough data yet.</p>;
  return (
    <div role="img" aria-label={`${label}: ${data.map((d) => `${d.month} ${d.value}`).join(", ")}`} className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#ddd5c6" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#6a766f" }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#6a766f" }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "#efe8dc" }} contentStyle={{ borderRadius: 12, border: "1px solid #ddd5c6" }} />
          <Bar dataKey="value" name={label} fill="#1f5a46" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
