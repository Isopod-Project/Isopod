import { AlertCircle, Smartphone } from "lucide-react";
import { BEDROCK_DEFAULT_PORT, BEDROCK_PORT_ENV, CROSSPLAY_ENV, supportsCrossplay } from "../lib/bedrock";

const BEDROCK_VERSIONS = [
   { id: "LATEST", name: "Latest release", desc: "Updates to the newest Bedrock release each time the server starts" },
   { id: "PREVIEW", name: "Preview", desc: "Beta builds for players on Minecraft Preview" },
];

/** Latest / Preview picker for a Bedrock server. A pinned version like 1.21.50.07 is typed into the version field. */
export function BedrockVersionOptions({ value, onChange }: { value: string; onChange: (version: string) => void }) {
   const selected = (value || "LATEST").toUpperCase();
   return (
      <div className="flex flex-col gap-2">
         {BEDROCK_VERSIONS.map((v) => (
            <button
               key={v.id}
               type="button"
               onClick={() => onChange(v.id)}
               aria-pressed={selected === v.id}
               className={`text-left px-4 py-3 rounded border transition-all ${selected === v.id ? "border-[#3E8ED0] bg-[#3E8ED0]/10 text-[#3E8ED0]" : "border-[#333] bg-[#141414] text-neutral-300 hover:border-[#444]"}`}
            >
               <div className="text-sm font-bold">{v.name}</div>
               <div className="text-[11px] text-neutral-500">{v.desc}</div>
            </button>
         ))}
      </div>
   );
}

interface CrossplayCardProps {
   environment: Record<string, string>;
   onChange: (environment: Record<string, string>) => void;
}

/** Instance Settings toggle that installs Geyser and Floodgate so Bedrock players can join a Java server. */
export function CrossplayCard({ environment, onChange }: CrossplayCardProps) {
   const type = (environment["TYPE"] || "VANILLA").toUpperCase();
   const supported = supportsCrossplay(type);
   const enabled = environment[CROSSPLAY_ENV] === "true";
   const port = environment[BEDROCK_PORT_ENV] || BEDROCK_DEFAULT_PORT;

   const toggle = () => {
      const next: Record<string, string> = { ...environment, [CROSSPLAY_ENV]: enabled ? "false" : "true" };
      if (!enabled && !next[BEDROCK_PORT_ENV]) next[BEDROCK_PORT_ENV] = BEDROCK_DEFAULT_PORT;
      onChange(next);
   };

   return (
      <div className="bg-[#242424] border border-[#3A3A3A] rounded-lg p-4 space-y-3" data-testid="crossplay-card">
         <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
               <Smartphone className="w-5 h-5 text-[#3E8ED0] mt-0.5 flex-shrink-0" />
               <div>
                  <div className="text-sm font-bold text-white">Bedrock cross-play</div>
                  <p className="text-xs text-neutral-500">
                     Installs Geyser and Floodgate so players on phones, consoles, and Windows can join this Java server without a Java account.
                  </p>
               </div>
            </div>
            <button
               type="button"
               role="switch"
               aria-checked={enabled}
               aria-label="Bedrock cross-play"
               disabled={!supported && !enabled}
               onClick={toggle}
               className={`w-12 h-6 rounded-full transition-all relative flex-shrink-0 ${enabled ? "bg-[#3E8ED0]" : "bg-[#333]"} ${!supported && !enabled ? "opacity-40 cursor-not-allowed" : ""}`}
            >
               <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${enabled ? "left-7" : "left-1"}`} />
            </button>
         </div>

         {!supported && (
            <p className="text-xs text-neutral-500">Cross-play is available on Paper, Purpur, Fabric, and NeoForge servers.</p>
         )}

         {enabled && supported && (
            <div className="space-y-3 pt-3 border-t border-[#333]">
               <div className="flex items-center justify-between gap-4">
                  <label htmlFor="bedrock-port" className="text-xs font-bold text-neutral-400">Bedrock port (UDP)</label>
                  <input
                     id="bedrock-port"
                     type="number"
                     min={1024}
                     max={65535}
                     value={port}
                     onChange={(e) => onChange({ ...environment, [BEDROCK_PORT_ENV]: e.target.value })}
                     className="w-28 bg-[#141414] border border-[#3A3A3A] px-2 py-1 rounded text-sm font-mono text-emerald-400 focus:outline-none focus:border-[#3E8ED0]"
                  />
               </div>
               <div role="note" className="bg-amber-500/10 border border-amber-500/30 p-3 rounded flex items-start gap-2 text-[11px] text-amber-400">
                  <AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
                  <span>
                     Geyser supports the newest Java releases; on an older Minecraft version, Bedrock players may not be able to join.
                     {type === "FABRIC" && " Fabric API is added to the mod list because Geyser needs it."}
                     {" "}Save and restart the server to apply. Forward the Bedrock port as UDP on your router.
                  </span>
               </div>
            </div>
         )}
      </div>
   );
}
