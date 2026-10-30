// Bedrock Dedicated Server instances (TYPE=BEDROCK) and Geyser/Floodgate cross-play for Java ones.
// Matches backend/bedrock.py.
export const BEDROCK_TYPE = "BEDROCK";
export const BEDROCK_DEFAULT_PORT = "19132";
export const CROSSPLAY_ENV = "ISOPOD_CROSSPLAY";
export const BEDROCK_PORT_ENV = "ISOPOD_BEDROCK_PORT";

// Java server types Geyser and Floodgate run on
export const CROSSPLAY_SERVER_TYPES = ["PAPER", "PURPUR", "FABRIC", "NEOFORGE"];

export const BEDROCK_LEVEL_TYPES = [
   { id: "DEFAULT", name: "Default" },
   { id: "FLAT", name: "Flat" },
   { id: "LEGACY", name: "Legacy (old infinite worlds)" },
];

export const BEDROCK_GAMEMODES = ["survival", "creative", "adventure"];

export const isBedrockType = (type?: string) => (type || "").toUpperCase() === BEDROCK_TYPE;

export const supportsCrossplay = (type?: string) => CROSSPLAY_SERVER_TYPES.includes((type || "").toUpperCase());

export const BEDROCK_SERVER_NOTE = "Bedrock Dedicated Server is Mojang's server for Minecraft on Windows, phones, tablets, and consoles. It can't run Java mods or plugins. Players join over UDP, so forward the port as UDP on your router.";

export const BEDROCK_OPS_NOTE = "Players added or removed here change on the running server straight away. Making someone an operator takes effect right away only if they're online; otherwise it applies the next time the server starts.";

export const BEDROCK_NO_BAN_NOTE = "Bedrock Dedicated Server has no ban command, so there's no Banned Players list. To keep someone out, turn the allowlist on and remove them from it.";

// Add-ons tab (the Mods tab on a Bedrock server). Matches backend/bedrock_addons.py.
export const BEDROCK_ADDON_EXTENSIONS = [".mcpack", ".mcaddon"];

export const BEDROCK_ADDONS_NOTE = "Upload a .mcpack or .mcaddon to install it and turn it on for the world. A .mcaddon's resource pack is installed with it and listed in the Resource Packs tab. Changes apply the next time the server starts. Marketplace content can't be installed.";

// Resource Packs tab on a Bedrock server. Matches RESOURCE_PACK_EXTENSIONS in backend/bedrock_addons.py.
export const BEDROCK_RESOURCE_PACK_EXTENSIONS = [".mcpack"];

export const BEDROCK_RESOURCE_PACKS_NOTE = "Upload a resource pack .mcpack to install it and turn it on for the world. Players download it when they join after the next restart. Behavior packs and .mcaddon files go in the Add-ons tab.";

// itzg/minecraft-bedrock-server writes this to texturepack-required in server.properties
export const BEDROCK_TEXTUREPACK_REQUIRED_ENV = "TEXTUREPACK_REQUIRED";
