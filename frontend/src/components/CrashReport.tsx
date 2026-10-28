import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, RefreshCw, Skull } from "lucide-react";
import { crashLabel, crashSummary, type CrashInfo } from "../lib/crash";

interface CrashReportData {
   report: {
      name: string;
      created: number;
      text: string;
      description: string | null;
      root_cause: string | null;
      suspects: string[];
   } | null;
   log_tail: string;
}

/** Red badge for an instance tile. Recovered crashes don't get one. */
export function CrashBadge({ crash }: { crash?: CrashInfo | null }) {
   if (!crash || crash.state === "recovered") return null;
   return (
      <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/30 rounded px-1.5 py-0.5" title={crashSummary(crash)}>
         <Skull className="w-3 h-3" />
         {crashLabel(crash)}
      </span>
   );
}

const lineClass = (line: string) => {
   const trimmed = line.trim();
   if (trimmed.startsWith("Caused by:")) return "text-red-400 font-bold";
   if (/^[\w$.]+(Exception|Error|Throwable)\b/.test(trimmed)) return "text-red-400";
   if (trimmed.startsWith("at ")) return "text-neutral-500";
   if (trimmed.startsWith("--")) return "text-[#3E8ED0] font-bold";
   if (trimmed.startsWith("Description:")) return "text-amber-300 font-bold";
   return "text-neutral-300";
};

export function CrashReportPanel({ instanceId, onBack }: { instanceId: string; onBack: () => void }) {
   const [data, setData] = useState<CrashReportData | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [isLoading, setIsLoading] = useState(true);

   const load = useCallback(async () => {
      setIsLoading(true);
      setError(null);
      try {
         const res = await fetch(`/api/instances/${instanceId}/crash-report`);
         if (!res.ok) throw new Error("Couldn't load the crash report.");
         setData(await res.json());
      } catch (e) {
         console.error("Failed to load crash report", e);
         setError(e instanceof Error ? e.message : String(e));
      } finally {
         setIsLoading(false);
      }
   }, [instanceId]);

   useEffect(() => { load(); }, [load]);

   const report = data?.report;

   return (
      <div className="flex flex-col h-full bg-[#181818] overflow-hidden">
         <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[#2C2C2C] bg-[#222222]">
            <div className="flex items-center gap-3">
               <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition-colors">
                  <ArrowLeft className="w-4 h-4" /> Console
               </button>
               <div className="flex items-center gap-2">
                  <Skull className="w-5 h-5 text-red-400" />
                  <span className="text-base font-bold text-white">Crash Report</span>
               </div>
            </div>
            <button type="button" onClick={load} className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition-colors">
               <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} /> Refresh
            </button>
         </div>

         <div className="flex-1 overflow-auto p-5 space-y-4 scrollbar-custom">
            {error && <p className="text-sm text-red-400">{error}</p>}
            {!isLoading && !error && !report && (
               <p className="text-sm text-neutral-400">
                  No crash report found in <span className="font-mono">crash-reports/</span>. Crashes like running out of memory or a port already in use don't write one; the last log lines below usually show why the server stopped.
               </p>
            )}

            {report && (
               <>
                  <div className="bg-red-500/5 border border-red-500/30 rounded-lg p-4 space-y-2">
                     <div className="text-xs text-neutral-500">
                        <span className="font-mono">{report.name}</span> · {new Date(report.created * 1000).toLocaleString()}
                     </div>
                     {report.description && <div className="text-sm text-amber-300 font-bold">{report.description}</div>}
                     <div className="flex items-start gap-2 text-sm">
                        <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                        <div>
                           <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Root cause</div>
                           <div className="font-mono text-red-300 break-all">{report.root_cause || "Not found in the report"}</div>
                        </div>
                     </div>
                     {report.suspects.length > 0 && (
                        <div>
                           <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Suspected mods</div>
                           <ul className="mt-1 flex flex-wrap gap-1.5">
                              {report.suspects.map(s => (
                                 <li key={s} className="font-mono text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded px-1.5 py-0.5">{s}</li>
                              ))}
                           </ul>
                        </div>
                     )}
                  </div>

                  <pre aria-label="Crash report text" className="text-[11px] font-mono bg-[#101010] border border-[#2C2C2C] rounded-lg p-4 overflow-auto whitespace-pre-wrap break-all">
                     {report.text.split("\n").map((line, i) => (
                        <div key={i} className={lineClass(line)}>{line || " "}</div>
                     ))}
                  </pre>
               </>
            )}

            {data?.log_tail && (
               <div>
                  <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-2">Last log lines</h4>
                  <pre className="text-[11px] font-mono bg-[#101010] border border-[#2C2C2C] rounded-lg p-4 overflow-auto whitespace-pre-wrap break-all">
                     {data.log_tail.split("\n").map((line, i) => (
                        <div key={i} className={lineClass(line)}>{line || " "}</div>
                     ))}
                  </pre>
               </div>
            )}
         </div>
      </div>
   );
}
