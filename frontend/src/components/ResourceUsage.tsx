import { Cpu, MemoryStick } from "lucide-react";
import { HelpButton } from "./HelpButton";
import { formatBytes } from "../lib/utils";

export interface InstanceUsage {
   cpu_percent: number;
   memory_used: number;
   memory_allocated: number | null;
}

export interface ResourceUsage {
   instances: Record<string, InstanceUsage>;
   total: {
      cpu_percent: number;
      memory_used: number;
      memory_allocated: number;
      host_memory: number | null;
      host_cpus: number | null;
   };
}

// `warn` turns the bar red near 100%.
function UsageBar({ percent, color, warn = false }: { percent: number; color: string; warn?: boolean }) {
   return (
      <div className="w-full bg-[#323232] rounded-full h-1.5 overflow-hidden">
         <div
            className={`h-1.5 rounded-full transition-all duration-500 ease-out ${warn && percent >= 90 ? "bg-red-500" : color}`}
            style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
         ></div>
      </div>
   );
}

/** Compact CPU / RAM totals across every running server, for the top bar. Hidden below
 * 1366px, where the top bar has no room left and its buttons start wrapping. */
export function ResourceTotals({ usage }: { usage: ResourceUsage | null }) {
   if (!usage) return null;
   const { total } = usage;
   const running = Object.keys(usage.instances).length;
   const memPct = total.host_memory ? (total.memory_used / total.host_memory) * 100 : 0;
   const memTitle = `RAM used by ${running} running ${running === 1 ? "server" : "servers"}, out of ${total.host_memory ? formatBytes(total.host_memory) : "unknown"} on the host` +
      (total.memory_allocated ? ` (${formatBytes(total.memory_allocated)} of Java heap configured)` : "");

   return (
      <div className="hidden min-[1366px]:flex items-center gap-3" data-testid="resource-totals">
         <div className="flex flex-col items-end w-12" title={`CPU used by ${running} running ${running === 1 ? "server" : "servers"}, as a share of ${total.host_cpus ?? "all"} host cores`}>
            <span className="text-[9px] font-black text-neutral-500 uppercase tracking-tighter leading-none mb-0.5 flex items-center gap-1">
               <Cpu className="w-2.5 h-2.5" /> CPU
            </span>
            <span className="text-[11px] font-mono font-bold text-neutral-400 leading-none mb-1">{total.cpu_percent.toFixed(1)}%</span>
            <UsageBar percent={total.cpu_percent} color="bg-sky-500" warn />
         </div>
         <div className="flex flex-col items-end w-20 whitespace-nowrap" title={memTitle}>
            <span className="text-[9px] font-black text-neutral-500 uppercase tracking-tighter leading-none mb-0.5 flex items-center gap-1">
               <MemoryStick className="w-2.5 h-2.5" /> RAM
            </span>
            <span className="text-[11px] font-mono font-bold text-neutral-400 leading-none mb-1">
               {total.host_memory
                  ? `${(total.memory_used / 1024 ** 3).toFixed(1)}/${Math.round(total.host_memory / 1024 ** 3)} GB`
                  : formatBytes(total.memory_used)}
            </span>
            <UsageBar percent={memPct} color="bg-emerald-500" warn />
         </div>
      </div>
   );
}

/** CPU / RAM usage of one running server, for the side panel. */
export function InstanceResources({ usage }: { usage: InstanceUsage | undefined }) {
   if (!usage) return null;
   return (
      <div className="w-full mt-3 px-4" data-testid="instance-resources">
         <div className="w-full bg-[#1A1A1A] border border-[#323232] p-2 rounded flex flex-col gap-2 shadow-inner">
            <div className="flex flex-col gap-1" title="Share of all host CPU cores">
               <div className="flex justify-between text-[10px] text-neutral-400 font-mono">
                  <span className="flex items-center gap-1"><Cpu className="w-3 h-3" /> CPU <HelpButton topic="resources" iconClassName="w-3 h-3" /></span>
                  <span>{usage.cpu_percent.toFixed(1)}%</span>
               </div>
               <UsageBar percent={usage.cpu_percent} color="bg-sky-500" warn />
            </div>
            {/* MEMORY only sizes the Java heap. The server also needs memory outside the heap
                (loaded classes, compiled code, threads, network buffers), so usage normally sits
                10-30% above it. Shown as two numbers rather than a bar so that isn't read as
                going over a limit. */}
            <div
               className="flex justify-between text-[10px] text-neutral-400 font-mono"
               title={"Total RAM the server is using. The heap is the memory set aside for Minecraft's world data;" +
                  " Java needs extra memory on top of it, so using more than the heap is normal."}
            >
               <span className="flex items-center gap-1"><MemoryStick className="w-3 h-3" /> RAM</span>
               <span>
                  {formatBytes(usage.memory_used)} used
                  {usage.memory_allocated ? <span className="text-neutral-500"> · {formatBytes(usage.memory_allocated)} heap</span> : null}
               </span>
            </div>
         </div>
      </div>
   );
}
