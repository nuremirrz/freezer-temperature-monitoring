import { AlertTriangle, CheckCircle2, MinusCircle } from "lucide-react";
import { UnitStatus } from "@/lib/api";

export function StatusIcon({ status, size = 18 }: { status: UnitStatus; size?: number }) {
  if (status === "alert") return <AlertTriangle size={size} className="text-alert shrink-0" />;
  if (status === "offline") return <MinusCircle size={size} className="text-offline shrink-0" />;
  return <CheckCircle2 size={size} className="text-ok shrink-0" />;
}

export function StatusDot({ status }: { status: UnitStatus }) {
  const color = status === "alert" ? "bg-alert" : status === "offline" ? "bg-offline" : "bg-ok";
  return <span className={`inline-block size-2 rounded-full ${color}`} />;
}
