import { useCallback, useEffect, useState } from "react";
import { Ban, Crown, LogOut, MessageSquare, Navigation, ShieldCheck, ShieldOff, Users } from "lucide-react";

export interface PlayerList {
   /** False when RCON couldn't be reached, e.g. the server is still finishing startup. */
   available: boolean;
   online: number;
   max: number;
   players: string[];
}

interface ManagedUser {
   name: string;
   is_op: boolean;
   level: number;
   whitelisted: boolean;
}

interface OnlinePlayersProps {
   instanceId: string;
   list: PlayerList | undefined;
   onChanged: () => void;
   showAlert: (message: string, title?: string) => Promise<void>;
   showConfirm: (message: string, title?: string) => Promise<boolean>;
   showPrompt: (message: string, defaultValue?: string, title?: string) => Promise<string | null>;
   showSelect: (message: string, options: string[], title?: string, defaultValue?: string) => Promise<string | null>;
}

const errorDetail = async (res: Response, fallback: string) => {
   try {
      const data = await res.json();
      return data.detail || fallback;
   } catch {
      return fallback;
   }
};

/** "3/20" player count for a dashboard tile; nothing until the first list arrives. */
export function PlayerCount({ list }: { list: PlayerList | undefined }) {
   if (!list?.available) return null;
   return (
      <span className="text-[10px] text-neutral-500 font-mono flex items-center gap-1" title={list.players.join(", ") || "No players online"} data-testid="player-count">
         <Users className="w-2.5 h-2.5" /> {list.online}/{list.max}
      </span>
   );
}

/** Online players for the side panel, each with kick/ban/op/whitelist/message/teleport actions. */
export function OnlinePlayers({ instanceId, list, onChanged, showAlert, showConfirm, showPrompt, showSelect }: OnlinePlayersProps) {
   const [expanded, setExpanded] = useState<string | null>(null);
   const [busy, setBusy] = useState(false);
   // Op and whitelist state lives in User Management, not in the `list` output
   const [users, setUsers] = useState<ManagedUser[]>([]);

   const fetchUsers = useCallback(async () => {
      try {
         const res = await fetch(`/api/instances/${instanceId}/users`);
         if (!res.ok) return;
         const data = await res.json();
         setUsers(Array.isArray(data) ? data : []);
      } catch (e) {
         console.error("Failed to fetch users", e);
      }
   }, [instanceId]);

   useEffect(() => {
      setExpanded(null);
      fetchUsers();
   }, [fetchUsers]);

   if (!list?.available) return null;

   const userFor = (name: string) => users.find((u) => u.name.toLowerCase() === name.toLowerCase());

   const runAction = async (name: string, action: string, extra: Record<string, string> = {}) => {
      setBusy(true);
      try {
         const res = await fetch(`/api/instances/${instanceId}/players/${encodeURIComponent(name)}/action`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, ...extra }),
         });
         if (!res.ok) throw new Error(await errorDetail(res, "Command failed"));
         if (["op", "deop", "whitelist_add", "whitelist_remove"].includes(action)) await fetchUsers();
         if (action === "kick" || action === "ban") setExpanded(null);
         onChanged();
      } catch (e) {
         await showAlert(e instanceof Error ? e.message : String(e), `Couldn't run ${action.replace("_", " ")} on ${name}`);
      } finally {
         setBusy(false);
      }
   };

   const handleKick = async (name: string) => {
      const reason = await showPrompt(`Kick ${name}? They can rejoin straight away. Add a reason (optional):`, "", "Kick player");
      if (reason !== null) runAction(name, "kick", { reason });
   };

   const handleBan = async (name: string) => {
      const reason = await showPrompt(`Ban ${name}? They'll be kicked and can't rejoin until pardoned. Add a reason (optional):`, "", "Ban player");
      if (reason !== null) runAction(name, "ban", { reason });
   };

   const handleMessage = async (name: string) => {
      const message = await showPrompt(`Private message to ${name}:`, "", "Message player");
      if (message?.trim()) runAction(name, "message", { message });
   };

   const handleTeleport = async (name: string) => {
      const others = list.players.filter((p) => p !== name);
      if (others.length === 0) {
         await showAlert("Teleporting needs another online player to send them to.", "Teleport");
         return;
      }
      const target = await showSelect(`Teleport ${name} to:`, others, "Teleport player", others[0]);
      if (target) runAction(name, "teleport", { target });
   };

   const handleOp = async (name: string, isOp: boolean) => {
      if (!isOp && !(await showConfirm(`Give ${name} operator permissions? Operators can run every server command.`, "Make operator"))) return;
      runAction(name, isOp ? "deop" : "op");
   };

   const actionButton = "flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

   return (
      <div className="w-full mt-3 px-4" data-testid="online-players">
         <div className="w-full bg-[#1A1A1A] border border-[#323232] p-2 rounded flex flex-col gap-1.5 shadow-inner">
            <div className="flex justify-between text-[10px] text-neutral-400 font-mono">
               <span className="flex items-center gap-1"><Users className="w-3 h-3" /> Players</span>
               <span>{list.online}/{list.max}</span>
            </div>
            {list.players.length === 0 ? (
               <span className="text-[11px] text-neutral-500 italic">Nobody online</span>
            ) : (
               <ul className="flex flex-col gap-0.5 max-h-56 overflow-auto">
                  {list.players.map((name) => {
                     const user = userFor(name);
                     const isOp = !!user && (user.is_op || user.level > 0);
                     const isWhitelisted = !!user?.whitelisted;
                     const isOpen = expanded === name;
                     return (
                        <li key={name} className="flex flex-col">
                           <button
                              onClick={() => setExpanded(isOpen ? null : name)}
                              className={`flex items-center justify-between px-1.5 py-1 rounded text-left text-xs transition-colors ${isOpen ? "bg-[#323232] text-white" : "text-neutral-300 hover:bg-[#2A2A2A]"}`}
                              aria-expanded={isOpen}
                           >
                              <span className="truncate">{name}</span>
                              {isOp && <span title="Operator"><Crown className="w-3 h-3 text-amber-400 flex-shrink-0" /></span>}
                           </button>
                           {isOpen && (
                              <div className="grid grid-cols-2 gap-1 p-1.5 animate-in fade-in duration-150">
                                 <button disabled={busy} onClick={() => handleMessage(name)} className={`${actionButton} text-neutral-300 hover:bg-[#323232]`}>
                                    <MessageSquare className="w-3 h-3" /> Message
                                 </button>
                                 <button disabled={busy} onClick={() => handleTeleport(name)} className={`${actionButton} text-neutral-300 hover:bg-[#323232]`}>
                                    <Navigation className="w-3 h-3" /> Teleport
                                 </button>
                                 <button disabled={busy} onClick={() => handleOp(name, isOp)} className={`${actionButton} text-amber-400 hover:bg-amber-500/10`}>
                                    <Crown className="w-3 h-3" /> {isOp ? "Deop" : "Op"}
                                 </button>
                                 <button
                                    disabled={busy}
                                    onClick={() => runAction(name, isWhitelisted ? "whitelist_remove" : "whitelist_add")}
                                    className={`${actionButton} text-sky-400 hover:bg-sky-500/10`}
                                    title={isWhitelisted ? "Remove from the whitelist" : "Add to the whitelist"}
                                 >
                                    {isWhitelisted ? <ShieldOff className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />} {isWhitelisted ? "Unwhitelist" : "Whitelist"}
                                 </button>
                                 <button disabled={busy} onClick={() => handleKick(name)} className={`${actionButton} text-red-400 hover:bg-red-500/10`}>
                                    <LogOut className="w-3 h-3" /> Kick
                                 </button>
                                 <button disabled={busy} onClick={() => handleBan(name)} className={`${actionButton} text-red-400 hover:bg-red-500/10`}>
                                    <Ban className="w-3 h-3" /> Ban
                                 </button>
                              </div>
                           )}
                        </li>
                     );
                  })}
               </ul>
            )}
         </div>
      </div>
   );
}
