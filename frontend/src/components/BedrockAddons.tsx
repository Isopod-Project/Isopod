import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { AlertCircle, Box, FlaskConical, Image as ImageIcon, Plus, RefreshCw, Trash2 } from "lucide-react";
import { BEDROCK_ADDON_EXTENSIONS, BEDROCK_ADDONS_NOTE } from "../lib/bedrock";

// Matches bedrock_addons.list_addons in backend/bedrock_addons.py
interface Addon {
   uuid: string | null;
   name: string;
   description: string;
   version: string;
   type: "behavior" | "resource";
   folder: string;
   enabled: boolean;
   beta_apis: string[];
   missing_dependencies: string[];
   error: string | null;
}

interface BedrockAddonsPanelProps {
   instanceId: string;
   isRunning: boolean;
   showAlert: (message: string, title?: string) => Promise<void>;
   showConfirm: (message: string, title?: string) => Promise<boolean>;
}

const errorDetail = async (res: Response, fallback: string) => {
   try {
      const data = await res.json();
      return data.detail || fallback;
   } catch {
      return fallback;
   }
};

const TYPE_LABELS = { behavior: "Behavior pack", resource: "Resource pack" };

/** The Add-ons tab of a Bedrock server: install .mcpack/.mcaddon files and turn packs on or off for the world. */
export function BedrockAddonsPanel({ instanceId, isRunning, showAlert, showConfirm }: BedrockAddonsPanelProps) {
   const [addons, setAddons] = useState<Addon[]>([]);
   const [world, setWorld] = useState("");
   const [isLoading, setIsLoading] = useState(true);
   const [loadError, setLoadError] = useState<string | null>(null);
   const [isUploading, setIsUploading] = useState(false);
   const [busyId, setBusyId] = useState<string | null>(null);
   // Something changed since the tab opened, so the server needs a restart to load it
   const [changed, setChanged] = useState(false);
   const fileInput = useRef<HTMLInputElement>(null);

   const fetchAddons = useCallback(async () => {
      try {
         const res = await fetch(`/api/instances/${instanceId}/addons`);
         if (!res.ok) throw new Error(await errorDetail(res, "Failed to load add-ons"));
         const data = await res.json();
         setAddons(Array.isArray(data.addons) ? data.addons : []);
         setWorld(data.world || "");
         setLoadError(null);
      } catch (e) {
         setLoadError((e as Error).message);
      } finally {
         setIsLoading(false);
      }
   }, [instanceId]);

   useEffect(() => {
      setIsLoading(true);
      setChanged(false);
      fetchAddons();
   }, [fetchAddons]);

   const upload = async (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      e.target.value = "";
      if (files.length === 0) return;
      setIsUploading(true);
      try {
         for (const file of files) {
            const form = new FormData();
            form.append("file", file);
            const res = await fetch(`/api/instances/${instanceId}/addons/upload`, { method: "POST", body: form });
            if (!res.ok) {
               await showAlert(await errorDetail(res, `${file.name} wasn't installed.`), "Add-on Not Installed");
               continue;
            }
            setChanged(true);
         }
      } finally {
         setIsUploading(false);
         await fetchAddons();
      }
   };

   const toggle = async (addon: Addon) => {
      if (!addon.uuid) return;
      setBusyId(addon.uuid);
      try {
         const res = await fetch(`/api/instances/${instanceId}/addons/toggle`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uuid: addon.uuid, enabled: !addon.enabled }),
         });
         if (!res.ok) throw new Error(await errorDetail(res, "Couldn't change the add-on"));
         setChanged(true);
         await fetchAddons();
      } catch (e) {
         await showAlert((e as Error).message, "Add-ons Error");
      } finally {
         setBusyId(null);
      }
   };

   const remove = async (addon: Addon) => {
      if (!addon.uuid) return;
      const confirmed = await showConfirm(`Remove ${addon.name}? Its files are deleted and the world stops using it.`, "Remove Add-on");
      if (!confirmed) return;
      setBusyId(addon.uuid);
      try {
         const res = await fetch(`/api/instances/${instanceId}/addons/delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uuid: addon.uuid }),
         });
         if (!res.ok) throw new Error(await errorDetail(res, "Couldn't remove the add-on"));
         setChanged(true);
         await fetchAddons();
      } catch (e) {
         await showAlert((e as Error).message, "Add-ons Error");
      } finally {
         setBusyId(null);
      }
   };

   return (
      <div className="flex flex-col h-full bg-[#1A1A1A] text-neutral-200" data-testid="bedrock-addons">
         <input
            type="file"
            ref={fileInput}
            accept={BEDROCK_ADDON_EXTENSIONS.join(",")}
            multiple
            onChange={upload}
            className="hidden"
            data-testid="addon-file-input"
         />

         <div className="px-5 py-3 border-b border-[#2C2C2C] bg-[#222222] flex items-center justify-between gap-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
               Add-ons ({addons.length} installed)
               {isLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#3E8ED0]" />}
               {world && <span className="text-[11px] font-normal text-neutral-500">World: {world}</span>}
            </h3>
            <button
               type="button"
               onClick={() => fileInput.current?.click()}
               disabled={isUploading}
               className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#3E8ED0] hover:bg-[#2B6A9E] text-white text-xs font-bold transition-all disabled:opacity-50"
            >
               {isUploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
               {isUploading ? "Installing..." : "Add File"}
            </button>
         </div>

         <div className="flex-1 overflow-auto scrollbar-custom p-4 space-y-3">
            <div role="note" className="bg-[#242424] border border-[#3A3A3A] p-3 rounded flex items-start gap-2 text-[11px] text-neutral-400">
               <AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0 text-[#3E8ED0]" />
               <span>{BEDROCK_ADDONS_NOTE}</span>
            </div>

            {loadError && (
               <div role="alert" className="bg-red-500/10 border border-red-500/30 p-3 rounded flex items-start gap-2 text-[11px] text-red-400">
                  <AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
                  <span>{loadError}</span>
               </div>
            )}

            {changed && isRunning && (
               <div role="status" className="bg-amber-500/10 border border-amber-500/30 p-3 rounded flex items-start gap-2 text-[11px] text-amber-400">
                  <AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
                  <span>Restart the server to apply your add-on changes.</span>
               </div>
            )}

            {!isLoading && !loadError && addons.length === 0 ? (
               <div className="py-16 text-center text-neutral-500 italic text-xs">
                  No add-ons installed. Click "Add File" to install a .mcpack or .mcaddon.
               </div>
            ) : (
               <div className="bg-[#1E1E1E] border border-[#2D2D2D] rounded divide-y divide-[#282828]">
                  {addons.map((addon) => (
                     <div key={`${addon.type}/${addon.folder}`} className="px-4 py-3 flex items-center gap-4" data-testid="addon-row">
                        <button
                           type="button"
                           role="switch"
                           aria-checked={addon.enabled}
                           aria-label={`Enable ${addon.name}`}
                           disabled={!addon.uuid || busyId === addon.uuid}
                           onClick={() => toggle(addon)}
                           className={`w-10 h-5 rounded-full transition-all relative flex-shrink-0 disabled:opacity-40 ${addon.enabled ? "bg-[#3E8ED0]" : "bg-[#333]"}`}
                        >
                           <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${addon.enabled ? "left-5" : "left-0.5"}`} />
                        </button>
                        {addon.type === "behavior"
                           ? <Box className="w-4 h-4 text-neutral-500 flex-shrink-0" />
                           : <ImageIcon className="w-4 h-4 text-neutral-500 flex-shrink-0" />}
                        <div className="flex-1 min-w-0">
                           <div className="flex items-baseline gap-2">
                              <span className="text-sm font-semibold text-[#E0E0E0] truncate">{addon.name}</span>
                              {addon.version && <span className="text-[11px] font-mono text-neutral-500">{addon.version}</span>}
                           </div>
                           <div className="text-[11px] text-neutral-500 truncate">
                              {TYPE_LABELS[addon.type]}{addon.description ? ` · ${addon.description}` : ""}
                           </div>
                           {addon.error && <div className="text-[11px] text-red-400">{addon.error}</div>}
                           {addon.beta_apis.length > 0 && (
                              <div className="mt-1 flex items-start gap-1.5 text-[11px] text-amber-400">
                                 <FlaskConical className="w-3.5 h-3.5 mt-px flex-shrink-0" />
                                 <span>
                                    Uses experimental Beta APIs. It only works if the world has the Beta APIs experiment on, which is set when the world is created in the game.
                                 </span>
                              </div>
                           )}
                           {addon.missing_dependencies.length > 0 && (
                              <div className="mt-1 flex items-start gap-1.5 text-[11px] text-amber-400">
                                 <AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
                                 <span>
                                    Needs {addon.missing_dependencies.length === 1 ? "a pack that isn't" : `${addon.missing_dependencies.length} packs that aren't`} installed. Upload the add-on's other .mcpack, or the whole .mcaddon.
                                 </span>
                              </div>
                           )}
                        </div>
                        <button
                           type="button"
                           onClick={() => remove(addon)}
                           disabled={!addon.uuid || busyId === addon.uuid}
                           className="p-1.5 rounded border border-red-500/20 bg-[#3D2525]/30 text-red-400 hover:bg-red-500/20 transition-all disabled:opacity-50"
                           title={`Remove ${addon.name}`}
                           aria-label={`Remove ${addon.name}`}
                        >
                           <Trash2 className="w-3.5 h-3.5" />
                        </button>
                     </div>
                  ))}
               </div>
            )}
         </div>
      </div>
   );
}
