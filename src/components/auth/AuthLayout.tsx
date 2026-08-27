import Image from "next/image";
import {
  Refrigerator,
  Snowflake,
  MapPin,
  LineChart,
  Bell,
  Settings,
  AlertTriangle,
  MinusCircle,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";

/** Decorative, faded dashboard preview used on the auth screens */
function DashboardPreview() {
  return (
    <div className="pointer-events-none relative mt-10 w-full max-w-2xl select-none opacity-70 [mask-image:linear-gradient(to_bottom,black_55%,transparent_100%)]">
      <div className="flex overflow-hidden rounded-2xl border border-line bg-panel shadow-sm">
        {/* mini sidebar */}
        <div className="flex w-10 shrink-0 flex-col items-center gap-3 border-r border-line-soft bg-page/60 py-3 text-faint">
          <span className="flex size-6 items-center justify-center rounded bg-offline-soft text-ink-soft">
            <MapPin size={13} />
          </span>
          <LineChart size={13} />
          <Bell size={13} />
          <Settings size={13} />
        </div>

        {/* mini content */}
        <div className="flex-1 p-3">
          <div className="mb-2 flex gap-3 border-b border-line-soft pb-1.5 text-[10px]">
            <span className="border-b-2 border-accent pb-1 font-semibold text-accent">Overview</span>
            <span className="text-faint">History</span>
          </div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold">Locations</span>
            <span className="flex items-center gap-0.5 text-[9px] text-faint">
              Sort: Alerts first <ChevronDown size={9} />
            </span>
          </div>
          <div className="mb-2 grid grid-cols-3 gap-1.5">
            <div className="rounded-md border border-line-soft p-1.5">
              <div className="flex items-center gap-1 text-[10px] font-semibold">
                <AlertTriangle size={10} className="text-alert" /> 3
              </div>
              <div className="text-[8px] text-faint">Alerts</div>
            </div>
            <div className="rounded-md border border-line-soft p-1.5">
              <div className="flex items-center gap-1 text-[10px] font-semibold">
                <MinusCircle size={10} className="text-offline" /> 1
              </div>
              <div className="text-[8px] text-faint">Offline</div>
            </div>
            <div className="rounded-md border border-line-soft p-1.5">
              <div className="flex items-center gap-1 text-[10px] font-semibold">
                <CheckCircle2 size={10} className="text-ok" /> 150
              </div>
              <div className="text-[8px] text-faint">Normal</div>
            </div>
          </div>
          {/* mini chart */}
          <div className="rounded-md border border-line-soft p-1.5">
            <div className="mb-1 text-[8px] text-faint">Temperature Trend (°F)</div>
            <svg viewBox="0 0 220 60" className="h-14 w-full">
              <line x1="0" y1="18" x2="220" y2="18" stroke="#e5484d" strokeWidth="1" strokeDasharray="3 3" />
              <text x="160" y="15" fontSize="6" fill="#e5484d">10°F Threshold</text>
              <polyline
                fill="none"
                stroke="#2970ff"
                strokeWidth="1.5"
                points="0,42 15,44 30,47 45,49 60,48 75,46 90,44 105,42 120,40 135,36 150,30 165,24 180,18 195,13 210,9 220,7"
              />
            </svg>
          </div>
        </div>

        {/* mini map */}
        <div className="relative w-2/5 shrink-0 bg-[#e8eef5]">
          <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "radial-gradient(#c3d0de 1px, transparent 1px)", backgroundSize: "12px 12px" }} />
          <span className="absolute top-[18%] left-[55%] flex size-3.5 items-center justify-center rounded-full bg-alert text-[7px] text-white shadow">!</span>
          <span className="absolute top-[38%] left-[25%] size-3 rounded-full border-2 border-white bg-ok shadow" />
          <span className="absolute top-[50%] left-[65%] size-3 rounded-full border-2 border-white bg-ok shadow" />
          <span className="absolute top-[62%] left-[40%] flex size-3.5 items-center justify-center rounded-full bg-alert text-[7px] text-white shadow">!</span>
          <span className="absolute top-[76%] left-[58%] size-3 rounded-full border-2 border-white bg-offline shadow" />
          <span className="absolute top-[86%] left-[30%] size-3 rounded-full border-2 border-white bg-ok shadow" />
        </div>
      </div>
    </div>
  );
}

export default function AuthLayout({
  headline,
  subtext,
  children,
}: {
  headline: [string, string];
  subtext: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-page">
      <div className="flex flex-1">
        {/* Left: brand + hero */}
        <div className="hidden flex-1 flex-col px-10 py-8 lg:flex xl:px-16">
          <div className="flex items-center gap-4">
            <Image src="/bk-logo.png" alt="Burger King" width={44} height={44} priority />
            <span className="h-8 w-px bg-line" />
            <span className="text-lg font-semibold">Freezer Temperature Monitor</span>
          </div>

          <div className="mt-16 flex items-start gap-8">
            <div className="relative flex size-28 shrink-0 items-center justify-center rounded-full bg-[#e8edf5]">
              <Refrigerator size={46} className="text-primary" strokeWidth={1.6} />
              <Snowflake size={17} className="absolute top-6 right-7 text-primary" />
            </div>
            <div className="pt-2">
              <h1 className="text-4xl leading-tight font-semibold tracking-tight text-primary">
                {headline[0]}
                <br />
                {headline[1]}
              </h1>
              <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted">{subtext}</p>
            </div>
          </div>

          <DashboardPreview />
        </div>

        {/* Right: form card */}
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-8 sm:px-6 md:py-10">
          {/* The brand column is off-screen below lg — keep the branding */}
          <div className="flex items-center gap-3 lg:hidden">
            <Image src="/bk-logo.png" alt="Burger King" width={36} height={36} priority />
            <span className="h-7 w-px bg-line" />
            <span className="text-base font-semibold">Freezer Temperature Monitor</span>
          </div>
          <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-6 shadow-sm sm:p-8">
            {children}
          </div>
        </div>
      </div>

      <footer className="flex flex-col items-center gap-3 px-5 py-5 text-center text-xs text-faint md:flex-row md:justify-between md:px-10 md:text-left xl:px-16">
        <span>© 2024 Burger King Company LLC. All rights reserved.</span>
        <div className="flex items-center gap-2">
          <a href="#" className="hover:text-muted">Privacy Policy</a>
          <span>|</span>
          <a href="#" className="hover:text-muted">Terms of Service</a>
          <span>|</span>
          <a href="#" className="hover:text-muted">Help Center</a>
        </div>
      </footer>
    </div>
  );
}
