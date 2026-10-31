import type React from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "../lib/utils";

const WIKI_URL = "https://isopod-project.github.io/Isopod-Website/#/wiki";

// Wiki "<article>/<section>" each part of the dashboard links to.
// Article and section ids are defined in the Isopod-Website repo (src/WikiPage.tsx).
const HELP_TOPICS = {
   dashboard: "dashboard-guide/manage-instances",
   networking: "port-forwarding",

   // New Instance modal tabs
   "new-custom": "dashboard-guide/create-instance",
   "new-import": "dashboard-guide/import-modpacks",
   "new-modrinth": "dashboard-guide/import-modpacks",
   "new-curseforge": "dashboard-guide/import-modpacks",

   // Instance editor tabs (keys match editTab)
   logs: "console-rcon/log-controls",
   users: "players-access",
   version: "versions-loaders/versions",
   loader: "versions-loaders/loaders",
   files: "file-manager",
   world: "world-settings",
   backups: "backups",
   mods: "mod-management",
   modpack: "dashboard-guide/modpack-updates",
   "resource-pack": "mod-management/resource-packs",
   config: "server-tuning",

   // Instance editor tabs on a Bedrock server ("bedrock-" + editTab)
   "bedrock-logs": "bedrock/bedrock-console",
   "bedrock-version": "bedrock/bedrock-server",
   "bedrock-files": "file-manager",
   "bedrock-world": "bedrock/bedrock-server",
   "bedrock-backups": "backups",
   "bedrock-mods": "bedrock/bedrock-addons",
   "bedrock-resource-pack": "bedrock/bedrock-resource-packs",
   "bedrock-config": "server-tuning",
   "bedrock-users": "bedrock/bedrock-allowlist",

   // Side panel and Logs tab cards
   crash: "crashes",
   "crash-report": "crashes/crash-report",
   snapshot: "backups/snapshots",
   resources: "monitoring/resource-usage",
   "online-players": "players-access/online-players",

   // Settings modal tabs (keys match "settings-" + settingsTab)
   "settings-general": "app-settings/general",
   "settings-language": "app-settings/language",
   "settings-appearance": "app-settings/appearance",
   "settings-defaults": "app-settings/defaults",
   "settings-updates": "app-settings/updates",
   "settings-advanced": "app-settings/advanced",
} as const;

export type HelpTopic = keyof typeof HELP_TOPICS;

const helpUrl = (topic: string) => {
   const path = HELP_TOPICS[topic as HelpTopic];
   return path ? `${WIKI_URL}/${path}` : WIKI_URL;
};

interface HelpButtonProps {
   // Unknown topics (e.g. a newly added tab) fall back to the wiki home
   topic: HelpTopic | (string & {});
   label?: string;
   className?: string;
   iconClassName?: string;
}

export function HelpButton({ topic, label, className, iconClassName }: HelpButtonProps) {
   const openHelp = (e: React.MouseEvent) => {
      // Help buttons sit inside clickable rows (e.g. the copy-address row)
      e.stopPropagation();
      window.open(helpUrl(topic), "_blank", "noopener,noreferrer");
   };

   return (
      <button
         type="button"
         onClick={openHelp}
         title="Open help for this section in the Isopod wiki"
         className={cn("flex items-center gap-2 text-neutral-500 hover:text-white transition-colors", className)}
      >
         <HelpCircle className={cn("w-4 h-4", iconClassName)} />
         {label}
      </button>
   );
}
