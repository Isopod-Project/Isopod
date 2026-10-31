import { useCallback, useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, ChevronRight, ExternalLink, Package, RefreshCw } from "lucide-react";
import { HelpButton } from "./HelpButton";

interface ModpackVersion {
   id: string;
   name: string;
   version_number: string;
   version_type: string;
   minecraft_version: string | null;
   loaders: string[];
   date_published: string;
   changelog: string | null;
}

interface ModpackStatus {
   project: { title: string; summary: string | null; icon_url: string | null; url: string };
   current: ModpackVersion | null;
   latest: ModpackVersion | null;
   update_available: boolean;
   versions: ModpackVersion[];
}

export interface ModpackUpdate {
   current: string;
   latest: string;
}

export interface ModpackUpdateResult {
   version_number: string;
   image: string;
   environment: Record<string, string>;
   restarted: boolean;
   restart_error: string | null;
}

interface ModpackPanelProps {
   instanceId: string;
   isRunning: boolean;
   showAlert: (message: string, title?: string) => Promise<void>;
   onUpdated: (result: ModpackUpdateResult) => void;
}

const CHANGELOG_PREVIEW_LENGTH = 400;

const errorDetail = async (res: Response, fallback: string) => {
   try {
      const data = await res.json();
      return data.detail || fallback;
   } catch {
      return fallback;
   }
};

const formatDate = (iso: string) => new Date(iso).toLocaleDateString();

const versionDetails = (version: ModpackVersion) =>
   [version.minecraft_version && `Minecraft ${version.minecraft_version}`, version.loaders.join(", "), formatDate(version.date_published)]
      .filter(Boolean)
      .join(" · ");

const changelogPreview = (changelog: string) =>
   changelog.length > CHANGELOG_PREVIEW_LENGTH ? `${changelog.slice(0, CHANGELOG_PREVIEW_LENGTH).trimEnd()}...` : changelog;

/** Green badge for an instance tile when a newer modpack version exists. */
export function ModpackUpdateBadge({ update }: { update?: ModpackUpdate | null }) {
   if (!update) return null;
   return (
      <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-1.5 py-0.5" title={`Modpack version ${update.latest} is available. This server is on ${update.current}.`}>
         <Package className="w-3 h-3" />
         Update Available
      </span>
   );
}

function VersionTypeTag({ type }: { type: string }) {
   const color = type === "release" ? "text-emerald-400 border-emerald-500/30" : type === "beta" ? "text-amber-400 border-amber-500/30" : "text-red-400 border-red-500/30";
   return <span className={`text-[10px] font-bold uppercase tracking-wider border rounded px-1.5 py-px ${color}`}>{type}</span>;
}

function ConfirmUpdateDialog({ target, current, isRunning, isUpdating, onCancel, onConfirm }: {
   target: ModpackVersion;
   current: ModpackVersion | null;
   isRunning: boolean;
   isUpdating: boolean;
   onCancel: () => void;
   onConfirm: (options: { backup: boolean; restart: boolean }) => void;
}) {
   const [backup, setBackup] = useState(true);
   const [restart, setRestart] = useState(true);
   const isOlder = !!current && target.date_published < current.date_published;
   const minecraftChanges = !!current && !!target.minecraft_version && target.minecraft_version !== current.minecraft_version;

   return (
      <div role="dialog" aria-label="Confirm modpack update" className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
         <div className="w-full max-w-lg bg-[#2A2A2A] border border-[#3A3A3A] rounded-lg shadow-2xl overflow-hidden">
            <div className="px-6 py-5 flex flex-col gap-4 text-sm text-neutral-300">
               <h3 className="text-lg font-bold text-white">{isOlder ? "Switch to an older version?" : "Update this modpack?"}</h3>
               <div className="bg-[#1A1A1A] border border-[#323232] rounded p-3">
                  <div className="flex items-center gap-2 font-bold text-white break-all">
                     {target.version_number}
                     <VersionTypeTag type={target.version_type} />
                  </div>
                  <div className="text-xs text-neutral-400 mt-1">{versionDetails(target)}</div>
                  {current && <div className="text-xs text-neutral-500 mt-1 break-all">Now on {current.version_number}</div>}
               </div>
               {minecraftChanges && (
                  <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/5 border border-amber-500/30 rounded p-3">
                     <AlertTriangle className="w-4 h-4 shrink-0" />
                     <span>
                        This changes Minecraft from {current?.minecraft_version} to {target.minecraft_version}. Worlds can't go back to an older Minecraft version without a backup, and new world features may not generate in chunks that already exist.
                     </span>
                  </div>
               )}
               <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} disabled={isUpdating} className="mt-0.5" />
                  <span>
                     Create backup before updating
                     <span className="block text-xs text-neutral-500">Saves the worlds, mods, config, and server settings, so you can roll back from the side panel or the Backups tab.</span>
                  </span>
               </label>
               {isRunning && (
                  <label className="flex items-start gap-2 cursor-pointer">
                     <input type="checkbox" checked={restart} onChange={(e) => setRestart(e.target.checked)} disabled={isUpdating} className="mt-0.5" />
                     <span>
                        Restart the server now
                        <span className="block text-xs text-neutral-500">Players are disconnected. If you leave this off, the new version installs the next time the server starts.</span>
                     </span>
                  </label>
               )}
            </div>
            <div className="px-6 py-4 bg-[#242424] border-t border-[#323232] flex justify-end gap-3">
               <button onClick={onCancel} disabled={isUpdating} className="px-4 py-2 text-xs font-bold text-neutral-400 hover:text-white transition-colors disabled:opacity-50">
                  Cancel
               </button>
               <button
                  onClick={() => onConfirm({ backup, restart: isRunning && restart })}
                  disabled={isUpdating}
                  className="flex items-center gap-2 px-4 py-2 rounded bg-[#3E8ED0] hover:bg-[#2B6A9E] text-white font-bold text-xs transition-all disabled:opacity-60"
               >
                  {isUpdating && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  {isUpdating ? "Updating..." : isOlder ? "Switch Version" : "Update"}
               </button>
            </div>
         </div>
      </div>
   );
}

export function ModpackPanel({ instanceId, isRunning, showAlert, onUpdated }: ModpackPanelProps) {
   const [status, setStatus] = useState<ModpackStatus | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [isLoading, setIsLoading] = useState(true);
   const [target, setTarget] = useState<ModpackVersion | null>(null);
   const [isUpdating, setIsUpdating] = useState(false);
   const [openChangelog, setOpenChangelog] = useState<string | null>(null);

   const load = useCallback(async (force = false) => {
      setIsLoading(true);
      try {
         const res = await fetch(`/api/instances/${instanceId}/modpack/status${force ? "?force=true" : ""}`);
         if (!res.ok) throw new Error(await errorDetail(res, "Couldn't check this modpack for updates."));
         setStatus(await res.json());
         setError(null);
      } catch (e) {
         setError((e as Error).message);
      } finally {
         setIsLoading(false);
      }
   }, [instanceId]);

   useEffect(() => {
      load();
   }, [load]);

   const applyUpdate = async (options: { backup: boolean; restart: boolean }) => {
      if (!target) return;
      setIsUpdating(true);
      try {
         const res = await fetch(`/api/instances/${instanceId}/modpack/update`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ version_id: target.id, ...options }),
         });
         if (!res.ok) throw new Error(await errorDetail(res, "Couldn't update the modpack."));
         const result: ModpackUpdateResult = await res.json();
         onUpdated(result);
         setTarget(null);
         await load();
         if (result.restart_error) {
            await showAlert(`The modpack is set to ${result.version_number}, but the server didn't restart: ${result.restart_error}`, "Restart Failed");
         } else if (result.restarted) {
            await showAlert(`The modpack is set to ${result.version_number}. The server is restarting and will install it now.`, "Modpack Updated");
         } else {
            await showAlert(`The modpack is set to ${result.version_number}. It installs the next time the server starts.`, "Modpack Updated");
         }
      } catch (e) {
         setTarget(null);
         await showAlert((e as Error).message, "Modpack Update Failed");
      } finally {
         setIsUpdating(false);
      }
   };

   if (!status) {
      return (
         <div className="flex-1 flex flex-col items-center justify-center gap-3 text-neutral-500 p-6 text-center">
            {isLoading ? (
               <RefreshCw className="w-6 h-6 animate-spin" />
            ) : (
               <>
                  <AlertCircle className="w-8 h-8 opacity-60" />
                  <p className="text-sm text-neutral-300 max-w-md">{error}</p>
                  <button onClick={() => load(true)} className="px-4 py-1.5 rounded bg-[#3E8ED0] hover:bg-[#2B6A9E] text-white font-bold text-sm">Retry</button>
               </>
            )}
         </div>
      );
   }

   const { project, current, latest, update_available: updateAvailable, versions } = status;

   return (
      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
         <div className="flex items-start gap-4 bg-[#222] border border-[#333] rounded-lg p-4">
            {project.icon_url ? (
               <img src={project.icon_url} alt="" className="w-16 h-16 rounded object-cover shrink-0" />
            ) : (
               <div className="w-16 h-16 rounded bg-[#3B3B3B] flex items-center justify-center shrink-0">
                  <Package className="w-8 h-8 text-[#878787]" />
               </div>
            )}
            <div className="flex-1 min-w-0">
               <h3 className="text-lg font-bold text-white break-words">{project.title}</h3>
               {project.summary && <p className="text-sm text-neutral-400 mt-0.5">{project.summary}</p>}
               <a href={project.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 mt-1.5">
                  View on Modrinth <ExternalLink className="w-3 h-3" />
               </a>
            </div>
            <div className="flex items-center gap-2 shrink-0">
               <button onClick={() => load(true)} disabled={isLoading} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#3A3A3A] text-neutral-300 hover:bg-[#323232] text-xs font-bold transition-all disabled:opacity-60">
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
                  Check Now
               </button>
               <HelpButton topic="modpack" />
            </div>
         </div>

         {error && (
            <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/5 border border-amber-500/30 rounded p-3">
               <AlertCircle className="w-4 h-4 shrink-0" />
               <span>{error}</span>
            </div>
         )}

         {updateAvailable && latest && (
            <div role="region" aria-label="Update available" className="bg-emerald-500/5 border border-emerald-500/30 rounded-lg p-4 flex flex-col gap-2">
               <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                     <div className="font-bold text-emerald-300 break-words">Update available: {latest.version_number}</div>
                     <div className="text-xs text-neutral-400 mt-0.5">{versionDetails(latest)}</div>
                  </div>
                  <button onClick={() => setTarget(latest)} className="shrink-0 px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all">
                     Update to Latest
                  </button>
               </div>
               {current?.minecraft_version && latest.minecraft_version && latest.minecraft_version !== current.minecraft_version && (
                  <div className="text-xs text-amber-300">New Minecraft version: {current.minecraft_version} to {latest.minecraft_version}</div>
               )}
               {latest.changelog && (
                  <pre className="text-xs text-neutral-300 whitespace-pre-wrap break-words font-sans bg-[#1A1A1A] border border-[#323232] rounded p-3">{changelogPreview(latest.changelog)}</pre>
               )}
            </div>
         )}

         <div className="bg-[#222] border border-[#333] rounded-lg p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-1">Current version</div>
            {current ? (
               <>
                  <div className="flex items-center gap-2 font-bold text-white break-all">
                     {current.version_number}
                     <VersionTypeTag type={current.version_type} />
                  </div>
                  <div className="text-xs text-neutral-400 mt-1">{versionDetails(current)}</div>
               </>
            ) : (
               <p className="text-sm text-neutral-400">Isopod can't tell which version this server is on. Pick one below to set it.</p>
            )}
         </div>

         <div className="bg-[#222] border border-[#333] rounded-lg overflow-hidden">
            <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 px-4 pt-3 pb-2">All versions ({versions.length})</div>
            <ul className="divide-y divide-[#323232]">
               {versions.map((version) => {
                  const isCurrent = version.id === current?.id;
                  const isOpen = openChangelog === version.id;
                  return (
                     <li key={version.id} className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                           <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 text-sm font-medium text-neutral-200 break-all">
                                 {version.version_number}
                                 <VersionTypeTag type={version.version_type} />
                              </div>
                              <div className="text-xs text-neutral-500 mt-0.5">{versionDetails(version)}</div>
                           </div>
                           <button
                              onClick={() => setOpenChangelog(isOpen ? null : version.id)}
                              aria-expanded={isOpen}
                              aria-label={`Changelog for ${version.version_number}`}
                              className="flex items-center gap-1 text-xs text-neutral-400 hover:text-white transition-colors shrink-0"
                           >
                              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                              Changelog
                           </button>
                           {isCurrent ? (
                              <span className="w-28 text-center text-xs font-bold text-emerald-400 shrink-0">Current</span>
                           ) : (
                              <button
                                 onClick={() => setTarget(version)}
                                 aria-label={`Switch to ${version.version_number}`}
                                 className="w-28 px-2 py-1.5 rounded border border-[#3A3A3A] text-neutral-300 hover:bg-[#323232] hover:text-white text-xs font-bold transition-all shrink-0"
                              >
                                 Switch
                              </button>
                           )}
                        </div>
                        {isOpen && (
                           <pre className="mt-2 text-xs text-neutral-300 whitespace-pre-wrap break-words font-sans bg-[#1A1A1A] border border-[#323232] rounded p-3">
                              {version.changelog || "This version has no changelog."}
                           </pre>
                        )}
                     </li>
                  );
               })}
            </ul>
         </div>

         {target && (
            <ConfirmUpdateDialog
               target={target}
               current={current}
               isRunning={isRunning}
               isUpdating={isUpdating}
               onCancel={() => setTarget(null)}
               onConfirm={applyUpdate}
            />
         )}
      </div>
   );
}
