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
