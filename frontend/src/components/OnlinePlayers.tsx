import { useCallback, useEffect, useState } from "react";
import { Ban, Crown, LogOut, MessageSquare, Navigation, RefreshCw, ShieldCheck, ShieldOff, Undo2, Users } from "lucide-react";
import { usePlayerActions, type BannedPlayer, type PlayerDialogs } from "./usePlayerActions";
import { fallbackAvatarUrl, playerAvatarUrl } from "../lib/utils";

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

interface OnlinePlayersProps extends PlayerDialogs {
   instanceId: string;
   list: PlayerList | undefined;
   onChanged: () => void;
}

const isOnline = (list: PlayerList | undefined, name: string) =>
   !!list?.players.some((p) => p.toLowerCase() === name.toLowerCase());

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
export function OnlinePlayers({ instanceId, list, onChanged, ...dialogs }: OnlinePlayersProps) {
   const [expanded, setExpanded] = useState<string | null>(null);
   // Op and whitelist state lives in User Management, not in the `list` output
   const [users, setUsers] = useState<ManagedUser[]>([]);

   const fetchUsers = useCallback(() =>
      fetch(`/api/instances/${instanceId}/users`)
         .then((res) => (res.ok ? res.json() : null))
         .then((data) => { if (data) setUsers(Array.isArray(data) ? data : []); })
         .catch((e) => console.error("Failed to fetch users", e)),
      [instanceId]);

   // The parent keys this component by instance, so switching servers starts fresh
   useEffect(() => {
      fetchUsers();
   }, [fetchUsers]);

   const actions = usePlayerActions(instanceId, dialogs, (action) => {
      if (["op", "deop", "whitelist_add", "whitelist_remove"].includes(action)) fetchUsers();
      if (action === "kick" || action === "ban") setExpanded(null);
      onChanged();
   });
   const busy = actions.busy;

   if (!list?.available) return null;

   const userFor = (name: string) => users.find((u) => u.name.toLowerCase() === name.toLowerCase());

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
                                 <button disabled={busy} onClick={() => actions.message(name)} className={`${actionButton} text-neutral-300 hover:bg-[#323232]`}>
                                    <MessageSquare className="w-3 h-3" /> Message
                                 </button>
                                 <button disabled={busy} onClick={() => actions.teleport(name, list.players)} className={`${actionButton} text-neutral-300 hover:bg-[#323232]`}>
                                    <Navigation className="w-3 h-3" /> Teleport
                                 </button>
                                 <button disabled={busy} onClick={() => actions.toggleOp(name, isOp)} className={`${actionButton} text-amber-400 hover:bg-amber-500/10`}>
                                    <Crown className="w-3 h-3" /> {isOp ? "Deop" : "Op"}
                                 </button>
                                 <button
                                    disabled={busy}
                                    onClick={() => actions.run(name, isWhitelisted ? "whitelist_remove" : "whitelist_add")}
                                    className={`${actionButton} text-sky-400 hover:bg-sky-500/10`}
                                    title={isWhitelisted ? "Remove from the whitelist" : "Add to the whitelist"}
                                 >
                                    {isWhitelisted ? <ShieldOff className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />} {isWhitelisted ? "Unwhitelist" : "Whitelist"}
                                 </button>
                                 <button disabled={busy} onClick={() => actions.kick(name)} className={`${actionButton} text-red-400 hover:bg-red-500/10`}>
                                    <LogOut className="w-3 h-3" /> Kick
                                 </button>
                                 <button disabled={busy} onClick={() => actions.ban(name)} className={`${actionButton} text-red-400 hover:bg-red-500/10`}>
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

interface PlayerRowActionsProps extends PlayerDialogs {
   instanceId: string;
   name: string;
   list: PlayerList | undefined;
   /** Server is Online, so RCON actions can run. */
   ready: boolean;
   banned: boolean;
   onChanged: (action: string) => void;
}

/**
 * Live actions for one User Management row: message/teleport/kick need the player online, ban
 * needs the server up. A banned player gets Unban instead, which also works while the server is stopped.
 */
export function PlayerRowActions({ instanceId, name, list, ready, banned, onChanged, ...dialogs }: PlayerRowActionsProps) {
   const actions = usePlayerActions(instanceId, dialogs, onChanged);
   const online = ready && isOnline(list, name);
   const button = "p-1.5 rounded border transition-all disabled:opacity-30 disabled:cursor-not-allowed";
   const offlineHint = ready ? `${name} isn't online` : "Start the server first";
   return (
      <>
         <button type="button" disabled={!online || actions.busy} onClick={() => actions.message(name)} title={online ? "Message" : offlineHint}
            className={`${button} text-neutral-300 border-[#3A3A3A] hover:bg-[#323232]`}>
            <MessageSquare className="w-3.5 h-3.5" />
         </button>
         <button type="button" disabled={!online || actions.busy} onClick={() => actions.teleport(name, list?.players || [])} title={online ? "Teleport" : offlineHint}
            className={`${button} text-neutral-300 border-[#3A3A3A] hover:bg-[#323232]`}>
            <Navigation className="w-3.5 h-3.5" />
         </button>
         <button type="button" disabled={!online || actions.busy} onClick={() => actions.kick(name)} title={online ? "Kick" : offlineHint}
            className={`${button} text-red-400 border-red-500/20 hover:bg-red-500/20`}>
            <LogOut className="w-3.5 h-3.5" />
         </button>
         {banned ? (
            <button type="button" disabled={actions.busy} onClick={() => actions.unban(name)} title="Unban"
               className={`${button} text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/20`}>
               <Undo2 className="w-3.5 h-3.5" />
            </button>
         ) : (
            <button type="button" disabled={!ready || actions.busy} onClick={() => actions.ban(name)} title={ready ? "Ban" : "Start the server first"}
               className={`${button} text-red-400 border-red-500/20 hover:bg-red-500/20`}>
               <Ban className="w-3.5 h-3.5" />
            </button>
         )}
      </>
   );
}

/** "Banned" badge for a User Management row. */
export function BannedBadge({ banned }: { banned: boolean }) {
   if (!banned) return null;
   return (
      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/15 border border-red-500/40 text-red-400" data-testid="user-banned">
         BANNED
      </span>
   );
}

/** "Online" badge for a User Management row. */
export function OnlineBadge({ list, name }: { list: PlayerList | undefined; name: string }) {
   if (!isOnline(list, name)) return null;
   return (
      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/15 border border-emerald-500/40 text-emerald-400" data-testid="user-online">
         ONLINE
      </span>
   );
}

interface BannedPlayersProps extends PlayerDialogs {
   instanceId: string;
   bans: BannedPlayer[];
   loading: boolean;
   /** Re-read the ban list, e.g. after an unban. */
   refresh: () => void;
}

/** Banned players with an Unban button. Unbanning works whether or not the server is running. */
export function BannedPlayers({ instanceId, bans, loading, refresh, ...dialogs }: BannedPlayersProps) {
   const actions = usePlayerActions(instanceId, dialogs, () => refresh());

   return (
      <div className="bg-[#242424] border border-[#3A3A3A] rounded-xl overflow-hidden shadow-xl" data-testid="banned-players">
         <div className="px-4 py-3 bg-gradient-to-r from-[#2D2D2D] to-[#242424] border-b border-[#3A3A3A] flex justify-between items-center">
            <span className="text-xs font-bold text-neutral-200 uppercase tracking-wider">Banned Players ({bans.length})</span>
            <button type="button" onClick={refresh} title="Reload ban list" className="p-1 rounded text-neutral-500 hover:text-white hover:bg-[#323232] transition-colors">
               <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
         </div>
         {bans.length === 0 ? (
            <div className="py-6 text-center text-sm text-neutral-600 italic">Nobody is banned.</div>
         ) : (
            <ul className="divide-y divide-[#2D2D2D]">
               {bans.map((b) => (
                  <li key={b.name} className="px-5 py-3 flex items-center gap-3 text-xs">
                     <img
                        src={playerAvatarUrl(b.uuid || b.name, 32)}
                        alt=""
                        className="w-7 h-7 rounded bg-[#141414] border border-[#333]"
                        onError={(e) => { e.currentTarget.src = fallbackAvatarUrl(b.name, 32); }}
                     />
                     <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-sm font-bold text-neutral-200">{b.name}</span>
                        <span className="text-[10px] text-neutral-500 truncate">
                           {b.reason || "No reason given"}
                           {b.created ? ` · ${new Date(b.created.replace(" ", "T").replace(/ ([+-]\d{2})(\d{2})$/, "$1:$2")).toLocaleDateString()}` : ""}
                           {b.source && b.source !== "Server" && b.source !== "Rcon" ? ` · by ${b.source}` : ""}
                        </span>
                     </div>
                     <button
                        type="button"
                        disabled={actions.busy}
                        onClick={() => actions.unban(b.name)}
                        className="flex items-center gap-1.5 px-3 py-1 rounded text-[10px] font-bold border bg-emerald-500/15 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 transition-all disabled:opacity-50"
                     >
                        <Undo2 className="w-3 h-3" /> Unban
                     </button>
                  </li>
               ))}
            </ul>
         )}
      </div>
   );
}
