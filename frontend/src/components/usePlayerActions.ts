import { useCallback, useState } from "react";

export interface PlayerDialogs {
   showAlert: (message: string, title?: string) => Promise<void>;
   showConfirm: (message: string, title?: string) => Promise<boolean>;
   showPrompt: (message: string, defaultValue?: string, title?: string) => Promise<string | null>;
   showSelect: (message: string, options: string[], title?: string, defaultValue?: string) => Promise<string | null>;
}

export interface BannedPlayer {
   name: string;
   uuid?: string;
   reason?: string;
   source?: string;
   created?: string;
}

const errorDetail = async (res: Response, fallback: string) => {
   try {
      const data = await res.json();
      return data.detail || fallback;
   } catch {
      return fallback;
   }
};

/** Per-player moderation (kick, ban, unban, op, whitelist, message, teleport) with its prompts. */
export function usePlayerActions(instanceId: string, dialogs: PlayerDialogs, onDone: (action: string) => void) {
   const [busy, setBusy] = useState(false);
   const { showAlert, showConfirm, showPrompt, showSelect } = dialogs;

   const run = async (name: string, action: string, extra: Record<string, string> = {}) => {
      setBusy(true);
      try {
         const res = await fetch(`/api/instances/${instanceId}/players/${encodeURIComponent(name)}/action`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, ...extra }),
         });
         if (!res.ok) throw new Error(await errorDetail(res, "Command failed"));
         onDone(action);
      } catch (e) {
         await showAlert(e instanceof Error ? e.message : String(e), `Couldn't run ${action.replace("_", " ")} on ${name}`);
      } finally {
         setBusy(false);
      }
   };

   const kick = async (name: string) => {
      const reason = await showPrompt(`Kick ${name}? They can rejoin straight away. Add a reason (optional):`, "", "Kick player");
      if (reason !== null) await run(name, "kick", { reason });
   };

   const ban = async (name: string) => {
      const reason = await showPrompt(`Ban ${name}? They'll be kicked and can't rejoin until unbanned. Add a reason (optional):`, "", "Ban player");
      if (reason !== null) await run(name, "ban", { reason });
   };

   const unban = async (name: string) => {
      if (await showConfirm(`Unban ${name}? They'll be able to join again.`, "Unban player")) await run(name, "pardon");
   };

   const message = async (name: string) => {
      const text = await showPrompt(`Private message to ${name}:`, "", "Message player");
      if (text?.trim()) await run(name, "message", { message: text });
   };

   const teleport = async (name: string, online: string[]) => {
      const others = online.filter((p) => p.toLowerCase() !== name.toLowerCase());
      if (others.length === 0) {
         await showAlert("Teleporting needs another online player to send them to.", "Teleport");
         return;
      }
      const target = await showSelect(`Teleport ${name} to:`, others, "Teleport player", others[0]);
      if (target) await run(name, "teleport", { target });
   };

   const toggleOp = async (name: string, isOp: boolean) => {
      if (!isOp && !(await showConfirm(`Give ${name} operator permissions? Operators can run every server command.`, "Make operator"))) return;
      await run(name, isOp ? "deop" : "op");
   };

   return { busy, run, kick, ban, unban, message, teleport, toggleOp };
}

/** The instance's ban list (banned-players.json), shared by the Managed Players rows and the Banned Players list. */
export function useBans(instanceId: string | undefined) {
   // Tagged with the instance it came from so another server's list never shows after switching
   const [loaded, setLoaded] = useState<{ instanceId: string; bans: BannedPlayer[] } | null>(null);
   const [loading, setLoading] = useState(false);

   const refresh = useCallback(() => {
      if (!instanceId) return Promise.resolve();
      setLoading(true);
      return fetch(`/api/instances/${instanceId}/bans`)
         .then((res) => (res.ok ? res.json() : null))
         .then((data) => { if (data) setLoaded({ instanceId, bans: Array.isArray(data) ? data : [] }); })
         .catch((e) => console.error("Failed to fetch bans", e))
         .finally(() => setLoading(false));
   }, [instanceId]);

   const bans = loaded && loaded.instanceId === instanceId ? loaded.bans : [];
   const isBanned = (name: string) => bans.some((b) => b.name.toLowerCase() === name.toLowerCase());
   return { bans, loading, refresh, isBanned };
}
