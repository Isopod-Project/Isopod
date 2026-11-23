import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, History, RefreshCw, RotateCcw, Skull } from "lucide-react";
import { HelpButton } from "./HelpButton";
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
   rollback?: RollbackInfo | null;
}

interface SnapshotRef {
   name: string;
   reason: string;
   created: number;
}

interface RollbackMember {
   id: string;
   name: string;
   previous: string;
   current: string | null;
   modrinth: boolean;
}

type SuggestionStatus = "previous_version" | "added" | "unchanged" | "no_history" | "removed" | "unmatched";

interface RollbackSuggestion {
   suspect: string;
   id: string | null;
   name: string;
   status: SuggestionStatus;
   reason: string;
   current?: string;
   previous?: string;
   snapshot: SnapshotRef | null;
   available: boolean;
   group: RollbackMember[];
   blockers?: string[];
   notes: string[];
}

interface RollbackInfo {
   suggestions: RollbackSuggestion[];
   snapshot: SnapshotRef | null;
   changes: { id: string; name: string; change: "added" | "removed" | "updated"; previous?: string; current?: string }[];
}

interface Dialogs {
   showAlert: (message: string, title?: string) => Promise<void>;
   showConfirm: (message: string, title?: string) => Promise<boolean>;
}

const STATUS_LABELS: Record<SuggestionStatus, string> = {
   previous_version: "Previous version recorded",
   added: "Added after the snapshot",
   unchanged: "Unchanged",
   no_history: "No recorded history",
   removed: "No longer installed",
   unmatched: "Not matched to a mod",
};

const version = (v?: string | null) => v || "unknown version";
const snapshotLabel = (snap: SnapshotRef) => `${snap.reason} (${new Date(snap.created * 1000).toLocaleString()})`;

async function errorDetail(res: Response, fallback: string) {
   try {
      const body = await res.json();
      return typeof body.detail === "string" ? body.detail : fallback;
   } catch {
      return fallback;
   }
}

/** What Isopod can say about rolling back each suspect mod, and the two rollback scopes it offers. */
function RollbackSuggestions({ instanceId, info, onDone, showAlert, showConfirm }: { instanceId: string; info: RollbackInfo; onDone: () => void } & Dialogs) {
   const [busy, setBusy] = useState<string | null>(null);

   const rollBack = async (s: RollbackSuggestion) => {
      if (!s.snapshot || !s.id) return;
      const files = s.group.map(m => `${m.name} ${version(m.current)} → ${version(m.previous)}`).join("\n");
      const pinned = s.group.some(m => m.modrinth) ? "\n\nModrinth mods are pinned to these versions until you remove and re-add them." : "";
      const confirmed = await showConfirm(
         `Put these mod files back as they were in the snapshot "${snapshotLabel(s.snapshot)}":\n\n${files}\n\n` +
         `Only these files change. The world, config, and other mods stay as they are. Isopod takes a snapshot first so you can undo this. The server must be stopped.${pinned}`,
         "Roll Back Mod",
      );
      if (!confirmed) return;
      setBusy(s.id);
      try {
         const res = await fetch(`/api/instances/${instanceId}/crash-report/rollback`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mod_id: s.id, snapshot: s.snapshot.name }),
         });
         if (!res.ok) throw new Error(await errorDetail(res, "Rollback failed"));
         const data: { restored: { name: string; version: string }[] } = await res.json();
         await showAlert(`Rolled back ${data.restored.map(r => `${r.name} to ${version(r.version)}`).join(", ")}. Start the server to test it.`, "Mod Rolled Back");
         onDone();
      } catch (e) {
         await showAlert((e as Error).message, "Rollback Error");
      } finally {
         setBusy(null);
      }
   };

   const restoreSnapshot = async (snap: SnapshotRef) => {
      const confirmed = await showConfirm(
         `Restore the whole snapshot "${snapshotLabel(snap)}"? This puts the world, mods, config, and server settings back to how they were. ` +
         "Everything since then is lost, including world progress. The server must be stopped.",
         "Restore Snapshot",
      );
      if (!confirmed) return;
      setBusy(snap.name);
      try {
         const res = await fetch(`/api/instances/${instanceId}/backups/${encodeURIComponent(snap.name)}/restore`, { method: "POST" });
         if (!res.ok) throw new Error(await errorDetail(res, "Restore failed"));
         await showAlert(`Restored ${snap.name}.`, "Snapshot Restored");
         onDone();
      } catch (e) {
         await showAlert((e as Error).message, "Restore Error");
      } finally {
         setBusy(null);
      }
   };

   return (
      <section aria-label="Rollback suggestions" className="bg-[#1E1E1E] border border-[#2C2C2C] rounded-lg p-4 space-y-3">
         <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[#3E8ED0]" />
            <h4 className="text-xs font-bold text-neutral-300 uppercase tracking-widest">Rollback suggestions</h4>
            <HelpButton topic="crash-rollback" />
         </div>
         <p className="text-xs text-neutral-500">
            Isopod compares each suspect with the mod files recorded in snapshots taken before the crash. It only suggests versions it recorded, and changes nothing until you choose to.
         </p>

         <ul className="space-y-2">
            {info.suggestions.map(s => (
               <li key={s.suspect} aria-label={`Suggestion for ${s.name}`} className="border border-[#2C2C2C] rounded-md p-3 space-y-1.5 bg-[#181818]">
                  <div className="flex flex-wrap items-center gap-2">
                     <span className="text-sm font-bold text-white">{s.name}</span>
                     <span className={`text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 border ${s.status === "previous_version" ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10" : "text-neutral-400 border-[#333] bg-[#222]"}`}>
                        {STATUS_LABELS[s.status]}
                     </span>
                  </div>
                  {s.status === "previous_version" && (
                     <div className="text-xs font-mono text-neutral-300">
                        {version(s.current)} <span className="text-neutral-500">now</span> → {version(s.previous)} <span className="text-neutral-500">before</span>
                     </div>
                  )}
                  <p className="text-xs text-neutral-400">{s.reason}</p>
                  {s.snapshot && <p className="text-[11px] text-neutral-500">Evidence: snapshot {snapshotLabel(s.snapshot)}</p>}
                  {s.group.length > 1 && (
                     <div className="text-xs text-neutral-400">
                        Rolled back together, because they depend on each other and changed after the snapshot:
                        <ul className="mt-1 ml-4 list-disc">
                           {s.group.map(m => (
                              <li key={m.id} className="font-mono text-[11px]">{m.name}: {m.current ? version(m.current) : "not installed"} → {version(m.previous)}</li>
                           ))}
                        </ul>
                     </div>
                  )}
                  {(s.blockers ?? []).map(b => <p key={b} className="text-xs text-amber-300">{b}</p>)}
                  {s.notes.map(n => <p key={n} className="text-xs text-neutral-500">{n}</p>)}
                  {s.status === "previous_version" && (
                     <button
                        type="button"
                        disabled={!s.available || busy !== null}
                        onClick={() => rollBack(s)}
                        title={s.available ? undefined : "Isopod can't roll this mod back on its own; see the reasons above."}
                        className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#3E8ED0]/15 hover:bg-[#3E8ED0]/25 border border-[#3E8ED0]/40 text-[#8EC1EA] text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                     >
                        <RotateCcw className={`w-3.5 h-3.5 ${busy === s.id ? "animate-spin" : ""}`} />
                        {s.group.length > 1 ? `Roll back ${s.group.length} mods` : `Roll back to ${version(s.previous)}`}
                     </button>
                  )}
               </li>
            ))}
         </ul>

         {info.snapshot && (
            <div className="border-t border-[#2C2C2C] pt-3 space-y-2">
               {info.changes.length > 0 && (
                  <div>
                     <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Mods changed since the newest snapshot</div>
                     <ul aria-label="Mod changes" className="mt-1 space-y-0.5">
                        {info.changes.map(c => (
                           <li key={c.id} className="text-[11px] font-mono text-neutral-400">
                              {c.change === "updated" ? `${c.name}: ${version(c.previous)} → ${version(c.current)}` : `${c.name}: ${c.change}`}
                           </li>
                        ))}
                     </ul>
                  </div>
               )}
               <p className="text-xs text-neutral-500">
                  To undo everything instead, restore the whole snapshot {snapshotLabel(info.snapshot)}. That also rolls back the world, so progress made since then is lost.
               </p>
               <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => restoreSnapshot(info.snapshot!)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#2A2A2A] hover:bg-[#333] border border-[#3A3A3A] text-neutral-300 text-xs font-bold transition-colors disabled:opacity-40"
               >
                  <History className="w-3.5 h-3.5" /> Restore whole snapshot
               </button>
            </div>
         )}
      </section>
   );
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

export function CrashReportPanel({ instanceId, onBack, showAlert, showConfirm }: { instanceId: string; onBack: () => void } & Dialogs) {
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
                  <HelpButton topic="crash-report" />
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

                  {data?.rollback && data.rollback.suggestions.length > 0 && (
                     <RollbackSuggestions instanceId={instanceId} info={data.rollback} onDone={load} showAlert={showAlert} showConfirm={showConfirm} />
                  )}

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
