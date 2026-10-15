import { useCallback, useEffect, useState } from "react";
import { Archive, Download, RefreshCw, RotateCcw, Save, Trash2 } from "lucide-react";

interface BackupSettings {
   enabled: boolean;
   interval_hours: number;
   keep: number;
}

interface BackupItem {
   name: string;
   size: number;
   created: number;
}

interface BackupsPanelProps {
   instanceId: string;
   showAlert: (message: string, title?: string) => Promise<void>;
   showConfirm: (message: string, title?: string) => Promise<boolean>;
}

const INTERVAL_PRESETS = [
   { label: "Every hour", hours: 1 },
   { label: "Every 6 hours", hours: 6 },
   { label: "Every 12 hours", hours: 12 },
   { label: "Daily", hours: 24 },
   { label: "Weekly", hours: 168 },
];

const formatSize = (bytes: number) => {
   if (bytes < 1024) return `${bytes} B`;
   if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
   if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
   return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const errorDetail = async (res: Response, fallback: string) => {
   try {
      const data = await res.json();
      return data.detail || fallback;
   } catch {
      return fallback;
   }
};

export function BackupsPanel({ instanceId, showAlert, showConfirm }: BackupsPanelProps) {
   const [settings, setSettings] = useState<BackupSettings>({ enabled: false, interval_hours: 24, keep: 7 });
   const [backups, setBackups] = useState<BackupItem[]>([]);
   const [worlds, setWorlds] = useState<string[]>([]);
   const [isLoading, setIsLoading] = useState(true);
   const [isSaving, setIsSaving] = useState(false);
   const [isBackingUp, setIsBackingUp] = useState(false);
   const [busyName, setBusyName] = useState<string | null>(null);

   const fetchBackups = useCallback(async () => {
      try {
         const res = await fetch(`/api/instances/${instanceId}/backups`);
         if (!res.ok) throw new Error(await errorDetail(res, "Failed to load backups"));
         const data = await res.json();
         if (data.settings) setSettings(data.settings);
         setBackups(Array.isArray(data.backups) ? data.backups : []);
         setWorlds(Array.isArray(data.worlds) ? data.worlds : []);
      } catch (e) {
         console.error("Failed to fetch backups", e);
      } finally {
         setIsLoading(false);
      }
   }, [instanceId]);

   useEffect(() => {
      setIsLoading(true);
      fetchBackups();
   }, [fetchBackups]);

   const saveSettings = async () => {
      setIsSaving(true);
      try {
         const res = await fetch(`/api/instances/${instanceId}/backups/settings`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(settings),
         });
         if (!res.ok) throw new Error(await errorDetail(res, "Failed to save backup schedule"));
         setSettings(await res.json());
         await showAlert("Backup schedule saved.", "Backups");
      } catch (e) {
         await showAlert((e as Error).message, "Backup Error");
      } finally {
         setIsSaving(false);
      }
   };

   const backupNow = async () => {
      setIsBackingUp(true);
      try {
         const res = await fetch(`/api/instances/${instanceId}/backups`, { method: "POST" });
         if (!res.ok) throw new Error(await errorDetail(res, "Backup failed"));
         await fetchBackups();
      } catch (e) {
         await showAlert((e as Error).message, "Backup Error");
      } finally {
         setIsBackingUp(false);
      }
   };

   const restoreBackup = async (name: string) => {
      const confirmed = await showConfirm(
         `Restore ${name}? The current world folders will be replaced with the ones in this backup. The server must be stopped.`,
         "Restore Backup",
      );
      if (!confirmed) return;
      setBusyName(name);
      try {
         const res = await fetch(`/api/instances/${instanceId}/backups/${encodeURIComponent(name)}/restore`, { method: "POST" });
         if (!res.ok) throw new Error(await errorDetail(res, "Restore failed"));
         await showAlert(`Restored ${name}.`, "Backups");
      } catch (e) {
         await showAlert((e as Error).message, "Restore Error");
      } finally {
         setBusyName(null);
      }
   };

   const deleteBackup = async (name: string) => {
      const confirmed = await showConfirm(`Delete ${name}? This cannot be undone.`, "Delete Backup");
      if (!confirmed) return;
      setBusyName(name);
      try {
         const res = await fetch(`/api/instances/${instanceId}/backups/${encodeURIComponent(name)}`, { method: "DELETE" });
         if (!res.ok) throw new Error(await errorDetail(res, "Delete failed"));
         await fetchBackups();
      } catch (e) {
         await showAlert((e as Error).message, "Backup Error");
      } finally {
         setBusyName(null);
      }
   };

   const isPreset = INTERVAL_PRESETS.some(p => p.hours === settings.interval_hours);

   return (
      <div className="flex flex-col h-full p-10 overflow-auto animate-in fade-in slide-in-from-bottom-4 duration-300">
         <div className="max-w-2xl mx-auto w-full space-y-10">
            <div>
               <div className="flex items-center gap-3 mb-2">
                  <Archive className="w-8 h-8 text-[#3E8ED0]" />
                  <h3 className="text-2xl font-bold text-white">World Backups</h3>
               </div>
               <p className="text-neutral-500 text-sm">
                  Schedule automatic backups of this instance's worlds. Backups are saved in the instance's <span className="font-mono">backups</span> folder; the oldest are removed once the limit is reached.
               </p>
            </div>

            {/* Schedule */}
            <div className="bg-[#242424] border border-[#3A3A3A] rounded-lg p-6 space-y-5">
               <label className="flex items-center justify-between cursor-pointer">
                  <div>
                     <div className="text-sm font-bold text-white">Automatic backups</div>
                     <div className="text-xs text-neutral-500">Back up the world on a schedule while Isopod is running.</div>
                  </div>
                  <input
                     type="checkbox"
                     aria-label="Automatic backups"
                     className="w-5 h-5 accent-[#3E8ED0]"
                     checked={settings.enabled}
                     onChange={(e) => setSettings(prev => ({ ...prev, enabled: e.target.checked }))}
                  />
               </label>

               <div className="grid grid-cols-2 gap-4">
                  <div>
                     <label htmlFor="backup-interval" className="block text-xs font-bold text-neutral-400 uppercase tracking-widest mb-2">Frequency</label>
                     <select
                        id="backup-interval"
                        className="w-full bg-[#141414] border border-[#3A3A3A] p-2.5 rounded focus:outline-none focus:border-[#3E8ED0] text-[#E0E0E0] text-sm"
                        value={settings.interval_hours}
                        onChange={(e) => setSettings(prev => ({ ...prev, interval_hours: Number(e.target.value) }))}
                     >
                        {!isPreset && <option value={settings.interval_hours}>Every {settings.interval_hours} hours</option>}
                        {INTERVAL_PRESETS.map(p => (
                           <option key={p.hours} value={p.hours}>{p.label}</option>
                        ))}
                     </select>
                  </div>
                  <div>
                     <label htmlFor="backup-keep" className="block text-xs font-bold text-neutral-400 uppercase tracking-widest mb-2">Backups to keep</label>
                     <input
                        id="backup-keep"
                        type="number"
                        min={1}
                        className="w-full bg-[#141414] border border-[#3A3A3A] p-2.5 rounded focus:outline-none focus:border-[#3E8ED0] text-[#E0E0E0] text-sm"
                        value={settings.keep}
                        onChange={(e) => setSettings(prev => ({ ...prev, keep: Math.max(1, Number(e.target.value) || 1) }))}
                     />
                  </div>
               </div>

               <div className="flex justify-end">
                  <button
                     type="button"
                     onClick={saveSettings}
                     disabled={isSaving}
                     className="px-5 py-2 bg-[#3E8ED0] hover:bg-[#2B6A9E] text-white rounded-lg font-bold text-xs shadow-md shadow-[#3E8ED0]/15 transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                     {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                     Save Schedule
                  </button>
               </div>
            </div>

            {/* Backup list */}
            <div className="space-y-3">
               <div className="flex items-center justify-between">
                  <div>
                     <h4 className="text-sm font-bold text-white">Saved backups</h4>
                     <p className="text-xs text-neutral-500">
                        {worlds.length > 0 ? `Worlds included: ${worlds.join(", ")}` : "No world folders found yet. Start the server once to generate the world."}
                     </p>
                  </div>
                  <button
                     type="button"
                     onClick={backupNow}
                     disabled={isBackingUp || worlds.length === 0}
                     className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg font-bold text-xs transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                     <Archive className={`w-3.5 h-3.5 ${isBackingUp ? "animate-pulse" : ""}`} />
                     {isBackingUp ? "Backing up..." : "Back Up Now"}
                  </button>
               </div>

               <div className="bg-[#242424] border border-[#3A3A3A] rounded-lg overflow-hidden">
                  {isLoading ? (
                     <div className="p-8 text-center text-neutral-500 italic text-sm">Loading backups...</div>
                  ) : backups.length === 0 ? (
                     <div className="p-8 text-center text-neutral-500 italic text-sm">No backups yet.</div>
                  ) : (
                     backups.map(b => (
                        <div key={b.name} className="px-4 py-3 flex items-center justify-between border-b border-[#2D2D2D] last:border-b-0">
                           <div>
                              <div className="font-mono text-sm text-[#E0E0E0]">{new Date(b.created * 1000).toLocaleString()}</div>
                              <div className="text-[11px] text-neutral-500">{b.name} · {formatSize(b.size)}</div>
                           </div>
                           <div className="flex items-center gap-1.5">
                              <a
                                 href={`/api/instances/${instanceId}/backups/${encodeURIComponent(b.name)}`}
                                 download
                                 className="p-1.5 rounded border border-[#3A3A3A] text-neutral-400 hover:text-white hover:bg-[#323232] transition-all"
                                 title="Download backup"
                              >
                                 <Download className="w-3.5 h-3.5" />
                              </a>
                              <button
                                 type="button"
                                 onClick={() => restoreBackup(b.name)}
                                 disabled={busyName === b.name}
                                 className="p-1.5 rounded border border-[#3A3A3A] text-sky-400 hover:bg-sky-500/10 transition-all disabled:opacity-50"
                                 title="Restore backup"
                              >
                                 <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                              <button
                                 type="button"
                                 onClick={() => deleteBackup(b.name)}
                                 disabled={busyName === b.name}
                                 className="p-1.5 rounded border border-red-500/20 bg-[#3D2525]/30 text-red-400 hover:bg-red-500/20 transition-all disabled:opacity-50"
                                 title="Delete backup"
                              >
                                 <Trash2 className="w-3.5 h-3.5" />
                              </button>
                           </div>
                        </div>
                     ))
                  )}
               </div>
            </div>
         </div>
      </div>
   );
}
