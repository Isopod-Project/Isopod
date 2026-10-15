import React, { useEffect, useState, useRef, useMemo } from "react";
import { Folder, Play, Square, Settings, Plus, RefreshCw, Layers, Gamepad2, AlertCircle, Edit, Trash2, Database, Cpu, Box, Terminal, X, Search, Check, ExternalLink, Save, ChevronRight, FileText, ArrowLeft, Monitor, Shield, Sun, Moon, Languages, Users, Pencil, Tag, Copy, List, Share, HelpCircle, Globe, Image, ArrowDown, RotateCcw, Skull, Download, Upload, FolderPlus, FilePlus, Scissors, Clipboard, Archive } from "lucide-react";
import { HelpButton } from "./components/HelpButton";
import { BackupsPanel } from "./components/BackupsPanel";

interface Instance {
   id: string;
   name: string;
   path: string;
   has_compose: boolean;
   status: string; // "Valid"
   group: string;
   icon_url?: string;
}

interface InstanceStatus {
   instance_id: string;
   is_running: boolean;
   is_ready: boolean;
   version?: string;
   port?: number;
   public_ip?: string;
   last_online?: number;
   containers: unknown[];
   startup_status?: string;
   startup_percent?: number;
}


export default function App() {
   const [instances, setInstances] = useState<Instance[]>([]);
   const [statuses, setStatuses] = useState<Record<string, InstanceStatus>>({});
   const [loading, setLoading] = useState(true);
   // States from branch 3
   const [groups, setGroups] = useState<string[]>(["No group"]);
   const [simplifiedConsole, setSimplifiedConsole] = useState(true);
   const [pendingIconId, setPendingIconId] = useState<string | null>(null);
   const iconInputRef = useRef<HTMLInputElement>(null);
   const [iconCacheBuster, setIconCacheBuster] = useState(Date.now());
   // Icon chosen in the New Instance modal; uploaded once the instance exists
   const [newIconFile, setNewIconFile] = useState<File | null>(null);
   const [newIconPreview, setNewIconPreview] = useState<string | null>(null);
   const newIconInputRef = useRef<HTMLInputElement>(null);
   useEffect(() => {
      if (!newIconFile) {
         setNewIconPreview(null);
         return;
      }
      const url = URL.createObjectURL(newIconFile);
      setNewIconPreview(url);
      return () => URL.revokeObjectURL(url);
   }, [newIconFile]);


   // Selected Instance for the right sidebar
   const [selectedId, setSelectedId] = useState<string | null>(null);

   // Context Menu state
   const [contextMenu, setContextMenu] = useState<{ x: number; y: number; instanceId: string } | null>(null);

   // Dialog state
   const [dialog, setDialog] = useState<{
      title: string;
      message: string;
      type: "alert" | "confirm" | "prompt" | "select";
      options?: string[];
      defaultValue?: string;
      onResult: (result: any) => void;
   } | null>(null);

   const showAlert = (message: string, title = "Alert") => {
      return new Promise<void>((resolve) => {
         setDialog({ title, message, type: "alert", onResult: () => { setDialog(null); setTimeout(resolve, 50); } });
      });
   };

   const showConfirm = (message: string, title = "Confirm") => {
      return new Promise<boolean>((resolve) => {
         setDialog({ title, message, type: "confirm", onResult: (res) => { setDialog(null); setTimeout(() => resolve(!!res), 50); } });
      });
   };

   const showPrompt = (message: string, defaultValue = "", title = "Prompt") => {
      return new Promise<string | null>((resolve) => {
         setDialog({ title, message, type: "prompt", defaultValue, onResult: (res) => { setDialog(null); setTimeout(() => resolve(res), 50); } });
      });
   };

   const showSelect = (message: string, options: string[], title = "Select Option", defaultValue = "") => {
      return new Promise<string | null>((resolve) => {
         setDialog({ title, message, type: "select", options, defaultValue, onResult: (res) => { setDialog(null); setTimeout(() => resolve(res), 50); } });
      });
   };

   // System Update States
   const [updateInfo, setUpdateInfo] = useState<any>(null);
   const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
   const [isUpdatingSystem, setIsUpdatingSystem] = useState(false);
   const [updateProgressState, setUpdateProgressState] = useState<{
      stage: "initiating" | "rebuilding" | "waiting_reconnect" | "success" | "error";
      progress: number;
      message: string;
      errorDetails?: string;
   } | null>(null);
   const [updateSuccessToast, setUpdateSuccessToast] = useState<string | null>(null);
   const [isVerbose, setIsVerbose] = useState(false);

   // Modal states
   const [isAddModalOpen, setIsAddModalOpen] = useState(false);
   const [newName, setNewName] = useState("");
   const [newPort, setNewPort] = useState("25565");
   const [isCreating, setIsCreating] = useState(false);
   const [importProgress, setImportProgress] = useState<number | null>(null);
   const [importStatus, setImportStatus] = useState<string>("");

   // Prism-like Add Modal States
   const [addStep, setAddStep] = useState<number>(1);
   const [addTab, setAddTab] = useState<"custom" | "import" | "modrinth" | "world">("custom");
   const [selectedAddVersion, setSelectedAddVersion] = useState("latest");
   const [selectedAddLoader, setSelectedAddLoader] = useState("VANILLA");
   const [searchModpacks, setSearchModpacks] = useState("");
   const [onlyServerSideModpacks, setOnlyServerSideModpacks] = useState(true);
   const [modpackResults, setModpackResults] = useState<any[]>([]);
   const [isModpackLoading, setIsModpackLoading] = useState(false);
   const [selectedModpack, setSelectedModpack] = useState<any>(null);
   const [modpackVersions, setModpackVersions] = useState<any[]>([]);
   const [selectedModpackVersion, setSelectedModpackVersion] = useState<string>("");
   const [isModpackVersionsLoading, setIsModpackVersionsLoading] = useState(false);
   const [importFile, setImportFile] = useState<File | null>(null);
   const [versionSearch, setVersionSearch] = useState("");
   const [versionFilters, setVersionFilters] = useState({
      Releases: true,
      Snapshots: false,
      Betas: false,
      Alphas: false
   });
   const [loaderVersions, setLoaderVersions] = useState<any[]>([]);
   const [isLoaderLoading, setIsLoaderLoading] = useState(false);
   const [selectedAddLoaderVersion, setSelectedAddLoaderVersion] = useState("latest");
   // World Settings
   const [newSeed, setNewSeed] = useState("");
   const [newLevelType, setNewLevelType] = useState("DEFAULT");
   const [newDifficulty, setNewDifficulty] = useState("easy");
   const [newGamemode, setNewGamemode] = useState("survival");
   const [newGenerateStructures, setNewGenerateStructures] = useState(true);
   const [newMemory, setNewMemory] = useState("1G");
   // Whitelist states for Add Modal
   const [modalWhitelistEnabled, setModalWhitelistEnabled] = useState(false);
   const [modalWhitelistUsers, setModalWhitelistUsers] = useState<string[]>([]);
   const [modalWhitelistUserDraft, setModalWhitelistUserDraft] = useState("");

   // Edit Modal states
   const [isEditModalOpen, setIsEditModalOpen] = useState(false);
   const [editTab, setEditTab] = useState("logs");
   const [serverLogs, setServerLogs] = useState<Record<string, string>>({});
   const [manualLogs, setManualLogs] = useState<Record<string, { anchor: string, content: string }[]>>({});
   const [isLogsLoading, setIsLogsLoading] = useState(false);
   // Instance Config States
   const [config, setConfig] = useState<{ image: string, environment: Record<string, string> }>({ image: "", environment: {} });
   const [originalConfig, setOriginalConfig] = useState<any>(null);
   const [isSaving, setIsSaving] = useState(false);

   // Export Modal states
   const [isExportModalOpen, setIsExportModalOpen] = useState(false);
   const [exportInstanceId, setExportInstanceId] = useState<string | null>(null);
   const [exportWorld, setExportWorld] = useState(true);
   const [exportConfigs, setExportConfigs] = useState(true);
   const [exportMods, setExportMods] = useState(true);
   const [exportPlugins, setExportPlugins] = useState(true);
   const [exportLogs, setExportLogs] = useState(false);

   // Versions
   const [mcVersions, setMcVersions] = useState<any[]>([]);
   const [isVersionsLoading, setIsVersionsLoading] = useState(false);

   // Mod Search States
   const [modSearchQuery, setModSearchQuery] = useState("");
   const [modSearchProvider, setModSearchProvider] = useState<"modrinth">("modrinth");
   const [modSearchResults, setModSearchResults] = useState<any[]>([]);
   const [isModSearching, setIsModSearching] = useState(false);
   const [modSearchVersion, setModSearchVersion] = useState("");
   const [modSearchLoader, setModSearchLoader] = useState("");
   interface InstanceModItem {
      filename: string;
      id: string;
      name: string;
      version: string;
      enabled: boolean;
      size: number;
      modified: number;
      modified_str: string;
      icon_url?: string | null;
      summary?: string | null;
      url?: string | null;
      provider?: string;
      source?: string;
   }
   const [modListView, setModListView] = useState<"list" | "search">("list");
   const [installedModsMeta, setInstalledModsMeta] = useState<any[]>([]);
   const [modMetaCache, setModMetaCache] = useState<Record<string, { name?: string; icon_url?: string; latest_version?: string }>>({});
   const [isMetaLoading, setIsMetaLoading] = useState(false);
   const [instanceMods, setInstanceMods] = useState<InstanceModItem[]>([]);
   const [isInstanceModsLoading, setIsInstanceModsLoading] = useState(false);
   const [selectedModFilename, setSelectedModFilename] = useState<string | null>(null);
   const [modFilterQuery, setModFilterQuery] = useState("");
   const modFileInputRef = useRef<HTMLInputElement>(null);
   const [consoleCommand, setConsoleCommand] = useState("");
   const [commandHistory, setCommandHistory] = useState<string[]>([]);
   const [historyIndex, setHistoryIndex] = useState<number>(-1);
   const [commandDraft, setCommandDraft] = useState("");
   const [isExecuting, setIsExecuting] = useState(false);
   const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
   const scrollRef = useRef<HTMLPreElement>(null);

   // Prism Launcher Console Controls
   const [logKeepUpdating, setLogKeepUpdating] = useState(true);
   const [logWrapLines, setLogWrapLines] = useState(true);
   const [logColorLines, setLogColorLines] = useState(true);
   const [logSearchQuery, setLogSearchQuery] = useState("");
   const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
   const [logCopied, setLogCopied] = useState(false);
   const [clearedLogsOffset, setClearedLogsOffset] = useState<Record<string, number>>({});
   const lastSearchedQueryRef = useRef("");

   // Version Change Handling
   const [isVersionModalOpen, setIsVersionModalOpen] = useState(false);
   const [pendingVersion, setPendingVersion] = useState("");
   const [updateLoader, setUpdateLoader] = useState(true);
   const [updateMods, setUpdateMods] = useState(true);
   const [isCheckingCompatibility, setIsCheckingCompatibility] = useState(false);
   const [compatibility, setCompatibility] = useState<{ compatible: any[], incompatible: any[] }>({ compatible: [], incompatible: [] });

   // File Browser States
   const [fileList, setFileList] = useState<any[]>([]);
   const [currentFilePath, setCurrentFilePath] = useState(".");
   const [isFilesLoading, setIsFilesLoading] = useState(false);
   const [viewingFile, setViewingFile] = useState<{ name: string, content: string } | null>(null);
   const [isGlobalBrowser, setIsGlobalBrowser] = useState(false);

   // Enhanced File Explorer State (#59)
   const [selectedFileNames, setSelectedFileNames] = useState<string[]>([]);
   const [fileClipboard, setFileClipboard] = useState<{ action: "cut" | "copy", files: string[], sourceDir: string, instanceId: string | null } | null>(null);
   const [fileContextMenu, setFileContextMenu] = useState<{ x: number, y: number, target: any | null } | null>(null);
   const [inlineEditing, setInlineEditing] = useState<{ type: "rename" | "new_file" | "new_folder", targetName?: string, value: string } | null>(null);
   const [draggedFileNames, setDraggedFileNames] = useState<string[] | null>(null);
   const [dragTargetFolder, setDragTargetFolder] = useState<string | null>(null);
   const [isExternalDragOver, setIsExternalDragOver] = useState(false);
   const [fileConflictModal, setFileConflictModal] = useState<{
      title: string;
      message: string;
      conflicts: string[];
      onResolve: (strategy: "overwrite" | "rename_new" | "cancel") => void;
   } | null>(null);
   const fileUploadInputRef = useRef<HTMLInputElement>(null);

   // Global App Settings
   const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
   const [settingsTab, setSettingsTab] = useState("general");
   const [globalSettings, setGlobalSettings] = useState({
      language: 'English',
      theme: 'Dark',
      defaultPort: '25565',
      defaultLoader: 'VANILLA',
      defaultMemory: '1G',
      autoRefresh: true,
      showSnapshots: false,
      autoCheckUpdates: true,
      defaultWhitelistEnabled: false,
      defaultWhitelistUsers: [] as string[],
      dockerSocket: '/var/run/docker.sock'
   });
   const [originalGlobalSettings, setOriginalGlobalSettings] = useState("");
   const [isSavingGlobal, setIsSavingGlobal] = useState(false);
   const [seenPlayers, setSeenPlayers] = useState<{ name: string, uuid: string }[]>([]);
   const [newWhitelistUser, setNewWhitelistUser] = useState("");
   const [whitelistPreview, setWhitelistPreview] = useState<{ name: string, uuid: string } | null>(null);
   const [isVerifyingUser, setIsVerifyingUser] = useState(false);

   const [copiedId, setCopiedId] = useState<string | null>(null);

   // User Management Tab States
   interface InstanceUser {
      name: string;
      uuid?: string;
      level: number;
      is_op: boolean;
      whitelisted: boolean;
      active?: boolean;
   }
   const [instanceUsers, setInstanceUsers] = useState<InstanceUser[]>([]);
   const [isUsersLoading, setIsUsersLoading] = useState(false);
   const [isUsersSaving, setIsUsersSaving] = useState(false);
   const [userSearchText, setUserSearchText] = useState("");
   const [userSearchPreview, setUserSearchPreview] = useState<{ name: string, uuid: string } | null>(null);
   const [isUserSearchVerifying, setIsUserSearchVerifying] = useState(false);
   const [isUserSearchFocused, setIsUserSearchFocused] = useState(false);

   const getPlayerAvatarUrl = (identifier: string, size = 32) => {
      if (!identifier) return `https://mc-heads.net/avatar/steve/${size}`;
      return `https://mc-heads.net/avatar/${identifier}/${size}`;
   };

   // Autocomplete suggestions for User Management (2-3 gamertags)
   const userSearchSuggestions = useMemo<{ name: string; uuid?: string }[]>(() => {
      const q = userSearchText.trim().toLowerCase();
      if (!q) return [];
      const map = new Map<string, { name: string; uuid?: string }>();
      if (userSearchPreview && userSearchPreview.name.toLowerCase().includes(q)) {
         map.set(userSearchPreview.name.toLowerCase(), userSearchPreview);
      }
      for (const p of seenPlayers) {
         if (p.name.toLowerCase().includes(q) && !map.has(p.name.toLowerCase())) {
            map.set(p.name.toLowerCase(), p);
         }
         if (map.size >= 3) break;
      }
      if (map.size < 3) {
         for (const u of instanceUsers) {
            if (u.name.toLowerCase().includes(q) && !map.has(u.name.toLowerCase())) {
               map.set(u.name.toLowerCase(), { name: u.name, uuid: u.uuid });
            }
            if (map.size >= 3) break;
         }
      }
      return Array.from(map.values()).slice(0, 3);
   }, [userSearchText, userSearchPreview, seenPlayers, instanceUsers]);

   // Resource Pack States
   const [resourcePackQuery, setResourcePackQuery] = useState("");
   const [resourcePackProvider, setResourcePackProvider] = useState<"modrinth">("modrinth");
   const [resourcePackResults, setResourcePackResults] = useState<any[]>([]);
   const [isResourcePackSearching, setIsResourcePackSearching] = useState(false);
   const [resourcePackListView, setResourcePackListView] = useState<"list" | "search">("list");
   const [installedResourcePacksMeta, setInstalledResourcePacksMeta] = useState<any[]>([]);
   const [isResourcePackMetaLoading, setIsResourcePackMetaLoading] = useState(false);

   // Bootstrap seenPlayers with defaults and common entries
   useEffect(() => {
      const defaults = globalSettings.defaultWhitelistUsers.map(u => ({ name: u, uuid: u }));
      const common = [
         { name: "TheTacominecart", uuid: "b14c0873-f8a8-4000-a058-10d686f27fad" },
         { name: "LumboJimbo", uuid: "19e8bd2f-748a-4087-99c4-6e08d4948cc4" },
         { name: "Technoblade", uuid: "ad8b121c-a330-4c8d-83c3-6311ce833c94" },
         { name: "Dream", uuid: "ec70bc6c-7023-4402-847c-c0494426545b" },
         { name: "TheTacomin", uuid: "8696c21e-7b7e-400a-b50a-f02755e1136c" },
         { name: "MumboJumbo", uuid: "853c80ef-3c37-49fd-aa49-938b674adae6" },
         { name: "Grian", uuid: "0475b5b4-d537-4f18-bb45-4e783ab5b6f3" }
      ];
      setSeenPlayers(prev => {
         const existing = new Set(prev.map(p => p.name.toLowerCase()));
         const toAdd = [...defaults, ...common].filter(p => !existing.has(p.name.toLowerCase()));
         return [...prev, ...toAdd];
      });
   }, [globalSettings.defaultWhitelistUsers]);

   useEffect(() => {
      const handleClick = () => setContextMenu(null);
      window.addEventListener('click', handleClick);
      return () => window.removeEventListener('click', handleClick);
   }, []);

   const handleContextMenu = (e: React.MouseEvent, id: string) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, instanceId: id });
      setSelectedId(id);
   };

   const handleRename = async (id: string) => {
      const inst = instances.find(i => i.id === id);
      const newName = await showPrompt("Enter new name for instance:", inst?.name, "Rename Instance");
      if (newName && newName !== inst?.name) {
         try {
            const res = await fetch(`/api/instances/${id}/rename`, {
               method: "POST",
               headers: { "Content-Type": "application/json" },
               body: JSON.stringify({ name: newName })
            });
            if (res.ok) {
               await fetchInstances();
               fetchGroups();
               if (id === selectedId) {
                  const data = await res.json();
                  setSelectedId(data.id);
               }
            } else {
               await showAlert("Failed to rename instance", "Error");
            }
         } catch (e) {
            await showAlert("Error renaming instance", "Error");
         }
      }
   };

   const fetchInstances = async () => {
      try {
         const res = await fetch("/api/instances");
         if (!res.ok) throw new Error("Backend error");
         const data = await res.json();
         setInstances(data as Instance[]);

         // Auto select the first instance if none is selected
         if (data.length > 0 && !selectedId) {
            setSelectedId(data[0].id);
         }

         for (const inst of data) {
            if (inst.has_compose) {
               fetchStatus(inst.id);
            }
         }
      } catch (e) {
         console.error(e);
         await showAlert("Failed to connect to Isopod backend. Is it running on port 8000?", "System Error");
      } finally {
         setLoading(false);
      }
   };

   const fetchStatus = async (id: string) => {
      try {
         const res = await fetch(`/api/instances/${id}/status`);
         const data = await res.json();
         setStatuses((prev: Record<string, InstanceStatus>) => ({ ...prev, [id]: data }));
      } catch (e) {
         console.error(e);
      }
   };

   const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setImportFile(file);
      const baseName = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
      setNewName(baseName);
      e.target.value = '';
   };

   const handleStart = async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
         setStatuses((prev: Record<string, InstanceStatus>) => ({
            ...prev,
            [id]: { ...prev[id], is_running: true, is_ready: false, startup_status: "Starting...", startup_percent: 5 } // Optimistic update
         }));
         const res = await fetch(`/api/instances/${id}/start`, { method: "POST" });
         if (!res.ok) {
            const data = await res.json();
            throw new Error(data.detail || "Failed to start container");
         }
         setTimeout(() => fetchStatus(id), 2000);
      } catch (e) {
         console.error(e);
         await showAlert(`Launch Error: ${e instanceof Error ? e.message : String(e)}`, "Launch Failed");
         fetchStatus(id);
      }
   };

   const handleStop = async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
         setStatuses((prev: Record<string, InstanceStatus>) => ({
            ...prev,
            [id]: { ...prev[id], is_running: false, is_ready: false, startup_status: "Stopping...", startup_percent: 50 } // Optimistic update
         }));
         const res = await fetch(`/api/instances/${id}/stop`, { method: "POST" });
         if (!res.ok) {
            const data = await res.json();
            throw new Error(data.detail || "Failed to stop container");
         }
         setTimeout(() => fetchStatus(id), 2000);
      } catch (e) {
         console.error(e);
         await showAlert(`Stop Error: ${e instanceof Error ? e.message : String(e)}`, "Stop Failed");
         fetchStatus(id);
      }
   };

   const handleKill = async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const confirmed = await showConfirm("Stopping the server is better, only use if it's hung. Are you sure you want to forcefully kill this server?", "Kill Server");
      if (!confirmed) return;
      try {
         setStatuses((prev: Record<string, InstanceStatus>) => ({
            ...prev,
            [id]: { ...prev[id], is_running: false, is_ready: false, startup_status: "Stopping...", startup_percent: 80 } // Optimistic update
         }));
         const res = await fetch(`/api/instances/${id}/kill`, { method: "POST" });
         if (!res.ok) {
            const data = await res.json();
            throw new Error(data.detail || "Failed to kill container");
         }
         setTimeout(() => fetchStatus(id), 1000);
      } catch (e) {
         console.error(e);
         await showAlert(`Kill Error: ${e instanceof Error ? e.message : String(e)}`, "Kill Failed");
         fetchStatus(id);
      }
   };

   const fetchLoaderVersions = async (loader: string, mcVersion: string) => {
      if (!loader || loader === "VANILLA") {
         setLoaderVersions([]);
         return;
      }
      setIsLoaderLoading(true);
      console.log(`DEBUG: Fetching loader versions for ${loader} ${mcVersion}`);
      try {
         // Use a stable latest version if mcVersion is still "latest"
         const finalMcVersion = mcVersion === "latest" ? "" : mcVersion;
         const res = await fetch(`/api/meta/loaders/${loader}?mc_version=${finalMcVersion}`);
         if (!res.ok) throw new Error("Loader fetch failed");
         const data = await res.json();
         console.log(`DEBUG: Loader versions data:`, data);
         setLoaderVersions(Array.isArray(data) ? data : []);
         setSelectedAddLoaderVersion("latest");
      } catch (e) {
         console.error("Failed to fetch loader versions", e);
         setLoaderVersions([]);
      } finally {
         setIsLoaderLoading(false);
      }
   };

   const fetchModpackVersions = async (packId: string, provider: string) => {
      setIsModpackVersionsLoading(true);
      try {
         const res = await fetch(`/api/mods/${provider}/${packId}/versions`);
         if (!res.ok) throw new Error("Failed to fetch modpack versions");
         const data = await res.json();
         setModpackVersions(data);
         if (data && data.length > 0) {
            const latestRelease = data.find((v: any) => v.version_type === "release") || data[0];
            setSelectedModpackVersion(latestRelease.id);
         } else {
            setSelectedModpackVersion("");
         }
      } catch (e) {
         console.error("Failed to fetch modpack versions", e);
         setModpackVersions([]);
         setSelectedModpackVersion("");
      } finally {
         setIsModpackVersionsLoading(false);
      }
   };

   const handleAddInstance = async (e: React.FormEvent) => {
      e.preventDefault();
      setIsCreating(true);
      try {
         if (addTab === 'import') {
            if (!importFile) {
               await showAlert("Please select a ZIP file first.", "Error");
               setIsCreating(false);
               return;
            }
            const formData = new FormData();
            formData.append("file", importFile);
            if (newName) formData.append("name", newName);
            if (newPort) formData.append("port", newPort);
            if (newDifficulty) formData.append("difficulty", newDifficulty);
            if (newGamemode) formData.append("gamemode", newGamemode);
            if (newSeed) formData.append("seed", newSeed);
            if (newLevelType) formData.append("level_type", newLevelType);
            formData.append("generate_structures", String(newGenerateStructures));
            if (newMemory) formData.append("memory", newMemory);

            setImportProgress(0);
            setImportStatus("Uploading ZIP file...");

            const xhr = new XMLHttpRequest();

            const promise = new Promise<any>((resolve, reject) => {
               xhr.upload.addEventListener("progress", (event) => {
                  if (event.lengthComputable) {
                     const percentage = Math.round((event.loaded / event.total) * 100);
                     setImportProgress(percentage);
                     if (percentage === 100) {
                        setImportStatus("Extracting ZIP on server...");
                     }
                  }
               });

               xhr.addEventListener("load", () => {
                  if (xhr.status >= 200 && xhr.status < 300) {
                     try {
                        resolve(JSON.parse(xhr.responseText));
                     } catch (e) {
                        resolve({ message: "Import completed" });
                     }
                  } else {
                     try {
                        const err = JSON.parse(xhr.responseText);
                        reject(new Error(err.detail || "Failed to import instance"));
                     } catch (e) {
                        reject(new Error("Failed to import instance"));
                     }
                  }
               });

               xhr.addEventListener("error", () => {
                  reject(new Error("Network upload error"));
               });

               xhr.open("POST", "/api/instances/import");
               xhr.send(formData);
            });

            const data = await promise;
            if (data?.id) await uploadNewInstanceIcon(data.id);
            setInstances((prev: Instance[]) => [...prev, data]);
            setIsAddModalOpen(false);
            setImportFile(null);
            setNewName("");
            setImportProgress(null);
            setImportStatus("");
            await showAlert("Instance imported successfully!", "Success");
            // Await the refresh before selecting so its first-instance fallback doesn't override the new selection
            await fetchInstances();
            if (data?.id) setSelectedId(data.id);
            setIsCreating(false);
            return;
         }

         const body: any = {
            name: newName,
            template: selectedAddLoader.toLowerCase(),
            port: parseInt(newPort || globalSettings.defaultPort || "25565"),
            version: selectedAddVersion === 'latest' ? '' : selectedAddVersion,
            loader_version: selectedAddLoaderVersion,
            modrinth_id: addTab === 'modrinth' && selectedModpack ? selectedModpack.id : null,
            cf_id: null,
            modpack_version: addTab === 'modrinth' && selectedModpack ? selectedModpackVersion : null,
            icon_url: addTab === 'modrinth' && selectedModpack ? selectedModpack.icon_url : null,
            seed: newSeed,
            level_type: newLevelType,
            difficulty: newDifficulty,
            gamemode: newGamemode,
            generate_structures: newGenerateStructures,
            memory: newMemory || globalSettings.defaultMemory || "1G",
            whitelist_enabled: modalWhitelistEnabled,
            whitelist_users: (modalWhitelistUsers && modalWhitelistUsers.length > 0) ? modalWhitelistUsers : (globalSettings.defaultWhitelistUsers || [])
         };

         const res = await fetch("/api/instances", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
         });
         if (!res.ok) throw new Error("Failed to create instance");
         const data = await res.json();
         await uploadNewInstanceIcon(data.id);

         setInstances((prev: Instance[]) => [...prev, data]);
         setIsAddModalOpen(false);

         // Reset states
         setNewName("");
         setSelectedModpack(null);
         setModpackVersions([]);
         setSelectedModpackVersion("");
         setSelectedAddVersion("latest");
         setSelectedAddLoader((globalSettings.defaultLoader || "VANILLA").toUpperCase());
         setSelectedAddLoaderVersion("latest");
         setNewPort(globalSettings.defaultPort || "25565");
         setNewSeed("");
         setNewLevelType("DEFAULT");
         setNewDifficulty("easy");
         setNewGamemode("survival");
         setNewGenerateStructures(true);
         setNewMemory(globalSettings.defaultMemory || "1G");
         setModalWhitelistEnabled(globalSettings.defaultWhitelistEnabled ?? false);
         setModalWhitelistUsers([...(globalSettings.defaultWhitelistUsers || [])]);
         setModalWhitelistUserDraft("");

         // Await the refresh before selecting so its first-instance fallback doesn't override the new selection
         await fetchInstances();
         setSelectedId(data.id);
      } catch (e) {
         console.error(e);
         await showAlert("Failed to create instance", "Creation Failed");
      } finally {
         setIsCreating(false);
         setImportProgress(null);
         setImportStatus("");
      }
   };


   const fetchGroups = async () => {
      try {
         const res = await fetch("/api/groups");
         const data = await res.json();
         setGroups(["No group", ...data.filter((g: string) => g !== "No group")]);
      } catch (e) {
         console.error(e);
      }
   };

   const handleChangeGroup = async (id: string) => {
      const current = groups.filter(g => g !== "No group");
      const options = ["No group", ...current, "+ New Group..."];
      const sel = await showSelect("Select a folder to move this server to:", options, "Move to Folder");
      if (sel) {
         let finalGroup = sel;
         if (sel === "+ New Group...") {
            finalGroup = await showPrompt("Enter a name for the new folder:", "", "Create New Folder") || "";
            if (!finalGroup) return;
         }
         await fetch(`/api/instances/${id}/group`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ group: finalGroup }) });
         fetchInstances(); fetchGroups();
      }
   };

   const handleDuplicate = async (id: string) => {
      const originalInstance = instances.find(i => i.id === id);
      const originalName = originalInstance ? originalInstance.name : id;
      const defaultName = `Copy of ${originalName}`;
      const name = await showPrompt("Name for duplicate:", defaultName, "Duplicate Server");
      if (name) {
         await fetch(`/api/instances/${id}/duplicate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
         fetchInstances();
      }
   };

   const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!pendingIconId || !e.target.files?.[0]) return;
      const file = e.target.files[0];
      const formData = new FormData();
      formData.append("file", file);
      try {
         const res = await fetch(`/api/instances/${pendingIconId}/icon`, { method: "POST", body: formData });
         if (res.ok) {
            setIconCacheBuster(Date.now());
            await fetchInstances();
         } else {
            await showAlert("Failed to upload icon. Ensure it is a valid image.", "Upload Error");
         }
      } catch (err) {
         console.error(err);
         await showAlert("Error uploading icon to server.", "Network Error");
      }
      setPendingIconId(null);
      e.target.value = "";
   };

   const uploadNewInstanceIcon = async (instanceId: string) => {
      if (!newIconFile) return;
      const formData = new FormData();
      formData.append("file", newIconFile);
      try {
         const res = await fetch(`/api/instances/${instanceId}/icon`, { method: "POST", body: formData });
         if (res.ok) setIconCacheBuster(Date.now());
      } catch (err) {
         console.error("Failed to upload instance icon", err);
      }
   };

   const handleExport = (id: string) => {
      setExportInstanceId(id);
      setExportWorld(true);
      setExportConfigs(true);
      setExportMods(true);
      setExportPlugins(true);
      setExportLogs(false);
      setIsExportModalOpen(true);
   };

   const handleExportSubmit = () => {
      if (!exportInstanceId) return;
      const params = new URLSearchParams({
         world: exportWorld.toString(),
         mods: exportMods.toString(),
         configs: exportConfigs.toString(),
         plugins: exportPlugins.toString(),
         logs: exportLogs.toString()
      });
      window.location.href = `/api/instances/${exportInstanceId}/export?${params.toString()}`;
      setIsExportModalOpen(false);
   };

   const handleRenameGroup = async (groupName: string) => {
      if (groupName === "No group") return;
      const newName = await showPrompt(`Enter new name for group "${groupName}":`, groupName, "Rename Group");
      if (newName && newName !== groupName) {
         try {
            const res = await fetch(`/api/groups/${encodeURIComponent(groupName)}/rename`, {
               method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ new_name: newName })
            });
            if (res.ok) { await fetchInstances(); await fetchGroups(); }
         } catch (e) { }
      }
   };

   const handleDeleteGroup = async (groupName: string) => {
      if (groupName === "No group") return;
      const confirmed = await showConfirm(`Are you sure you want to remove the group "${groupName}"?`, "Remove Group");
      if (!confirmed) return;
      try {
         const res = await fetch(`/api/groups/${encodeURIComponent(groupName)}`, { method: "DELETE" });
         if (res.ok) { await fetchInstances(); await fetchGroups(); }
      } catch (e) { }
   };

   const handleDelete = async (id: string) => {
      const confirmed = await showConfirm("Are you sure you want to permanently delete this instance and all its files?", "Delete Instance");
      if (!confirmed) return;
      try {
         await fetch(`/api/instances/${id}`, { method: "DELETE" });
         setSelectedId(null);
         fetchInstances();
      } catch (err) {
         console.error(err);
         await showAlert("Error deleting instance", "Delete Error");
      }
   };

   const fetchLogs = React.useCallback(async (id: string) => {
      setIsLogsLoading(true);
      try {
         const res = await fetch(`/api/instances/${id}/logs`);
         const data = await res.json();

         // We strip ANSI codes here because they never look good in <pre>
         // but we keep all lines; filtering happens in the UI based on isVerbose
         const cleanLogs = (data.logs || "").replace(/\x1B\[[0-9;]*[mK]/g, "");
         setServerLogs(prev => ({ ...prev, [id]: cleanLogs }));
      } catch (e) {
         console.error(e);
         setServerLogs(prev => ({ ...prev, [id]: "Failed to load logs." }));
      } finally {
         setIsLogsLoading(false);
      }
   }, []);

   const fetchConfig = async (id: string) => {
      try {
         const res = await fetch(`/api/instances/${id}/config`);
         const data = await res.json();
         setConfig(data);
         setOriginalConfig(JSON.stringify(data));
         return data;
      } catch (e) {
         console.error("Failed to fetch config", e);
         return null;
      }
   };

   const fetchInstanceUsers = async (id: string) => {
      setIsUsersLoading(true);
      try {
         const res = await fetch(`/api/instances/${id}/users`);
         if (res.ok) {
            const data = await res.json();
            const usersList: InstanceUser[] = Array.isArray(data) ? data : (data.users || []);
            setInstanceUsers(usersList);
            setSeenPlayers(prev => {
               const existing = new Set(prev.map(p => p.name.toLowerCase()));
               const toAdd = usersList
                  .filter(u => u.name && !existing.has(u.name.toLowerCase()))
                  .map(u => ({ name: u.name, uuid: u.uuid || u.name }));
               return [...prev, ...toAdd];
            });
            const wlHeader = res.headers.get("X-Whitelist-Enabled");
            if (wlHeader !== null) {
               setConfig(prev => ({
                  ...prev,
                  environment: {
                     ...prev.environment,
                     ENABLE_WHITELIST: wlHeader === "true" ? "true" : "false"
                  }
               }));
            }
         }
      } catch (e) {
         console.error("Failed to fetch instance users", e);
      } finally {
         setIsUsersLoading(false);
      }
   };

   const saveInstanceUsers = async (id: string) => {
      setIsUsersSaving(true);
      const isWlOn = config.environment["ENABLE_WHITELIST"]?.toLowerCase() === "true";
      try {
         const res = await fetch(`/api/instances/${id}/users`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
               users: instanceUsers,
               whitelist_enabled: isWlOn
            })
         });
         if (res.ok) {
            await showAlert("User management and whitelist saved successfully.", "Success");
         } else {
            throw new Error("Failed to save user configuration");
         }
      } catch (e: any) {
         await showAlert("Error saving users: " + e.message, "Save Failed");
      } finally {
         setIsUsersSaving(false);
      }
   };

   // Verify Minecraft User for User Management Tab
   useEffect(() => {
      const timer = setTimeout(async () => {
         if (userSearchText.length >= 3) {
            setIsUserSearchVerifying(true);
            try {
               const res = await fetch(`https://playerdb.co/api/player/minecraft/${userSearchText}`);
               if (res.ok) {
                  const data = await res.json();
                  if (data.success && data.data && data.data.player) {
                     const p = {
                        name: data.data.player.username,
                        uuid: data.data.player.raw_id || data.data.player.id
                     };
                     setUserSearchPreview(p);
                     setSeenPlayers(prev => {
                        if (prev.find(x => x.name.toLowerCase() === p.name.toLowerCase())) return prev;
                        return [p, ...prev].slice(0, 50);
                     });
                  } else {
                     setUserSearchPreview(null);
                  }
               } else {
                  setUserSearchPreview(null);
               }
            } catch (e) { setUserSearchPreview(null); }
            finally { setIsUserSearchVerifying(false); }
         } else {
            setUserSearchPreview(null);
         }
      }, 500);
      return () => clearTimeout(timer);
   }, [userSearchText]);

   const fetchMcVersions = async () => {
      setIsVersionsLoading(true);
      try {
         const res = await fetch("/api/meta/versions");
         if (!res.ok) throw new Error("Failed to fetch versions");
         const data = await res.json();
         const versions = data.versions || [];
         setMcVersions(versions);

         // Auto-resolve 'latest' if it's still selected
         if (selectedAddVersion === "latest" && versions.length > 0) {
            const latestStable = versions.find((v: any) => v.type === 'release');
            if (latestStable) {
               setSelectedAddVersion(latestStable.id);
            }
         }
      } catch (e) {
         console.error("Failed to fetch MC versions", e);
      } finally {
         setIsVersionsLoading(false);
      }
   };

   const handleModpackSearch = async (query: string, provider: string) => {
      setIsModpackLoading(true);
      try {
         const url = provider === "modrinth"
            ? `/api/mods/search/${provider}?q=${encodeURIComponent(query)}&class_type=modpack&only_server_side=${onlyServerSideModpacks}`
            : `/api/mods/search/${provider}?q=${encodeURIComponent(query)}&class_type=modpack`;
         const res = await fetch(url);
         if (!res.ok) throw new Error(`${provider} search failed`);
         const data = await res.json();
         setModpackResults(Array.isArray(data) ? data : []);
      } catch (e) {
         console.error("Search error:", e);
         setModpackResults([]);
      } finally {
         setIsModpackLoading(false);
      }
   };


   const handleSaveConfig = async () => {
      if (!selectedId || !config) return;

      // IMPORTANT: Do NOT delete RESOURCE_PACK_ID — set it to empty string instead.
      // The itzg image only overwrites server.properties values for env vars that are present.
      // If we delete the env var, the old stale value (e.g. "fresh-animations") persists in server.properties.
      // Create a copy of the environment for final processing
      const finalEnv: Record<string, string> = { ...config.environment };

      // Explicitly clear legacy problematic keys but KEEP internal tracking
      delete finalEnv["ISOPOD_PACK_ID"];

      // Force-reset RESOURCE_PACK_ID to empty so itzg clears it from server.properties
      finalEnv["RESOURCE_PACK_ID"] = "";

      // The itzg image does NOT have a built-in RESOURCE_PACK_ID env var.
      // Use CUSTOM_SERVER_PROPERTIES to explicitly clear the stale resource-pack-id 
      // that was previously written to server.properties.
      const customProps: string[] = [];
      customProps.push("resource-pack-id=");

      // Merge with any existing custom properties
      if (finalEnv["CUSTOM_SERVER_PROPERTIES"]) {
         const existing = finalEnv["CUSTOM_SERVER_PROPERTIES"].split("\n")
            .filter(l => !l.trim().startsWith("resource-pack-id"));
         customProps.push(...existing);
      }
      finalEnv["CUSTOM_SERVER_PROPERTIES"] = customProps.join("\n");

      // Safety check for uppercase policy — only RESOURCE_PACK_ENFORCE is recognized by itzg image
      if (finalEnv["RESOURCE_PACK_ENFORCE"] === "true") finalEnv["RESOURCE_PACK_ENFORCE"] = "TRUE";
      // Remove REQUIRE_RESOURCE_PACK — it's not a real itzg env var and may cause conflicts
      delete finalEnv["REQUIRE_RESOURCE_PACK"];

      // Final prompt safety
      if (finalEnv["RESOURCE_PACK_PROMPT"] && !finalEnv["RESOURCE_PACK_PROMPT"].trim().startsWith('{')) {
         finalEnv["RESOURCE_PACK_PROMPT"] = JSON.stringify({ text: finalEnv["RESOURCE_PACK_PROMPT"] });
      }

      const updatedConfig = { ...config, environment: finalEnv };

      if (JSON.stringify(updatedConfig) === originalConfig) {
         await showAlert("No changes to save.", "Settings");
         return;
      }

      const status = statuses[selectedId];
      const isRunning = status && status.is_running;

      let proceed = false;
      let shouldRestartAfter = false;

      if (isRunning) {
         const confirmed = await showConfirm("Apply changes and restart the server now?", "Apply Configuration");
         if (confirmed) {
            proceed = true;
            shouldRestartAfter = true;
         }
      } else {
         const confirmed = await showConfirm("Save changes to instance configuration?", "Save Configuration");
         if (confirmed) {
            proceed = true;
         }
      }

      if (!proceed) return;

      setIsSaving(true);
      try {
         const res = await fetch(`/api/instances/${selectedId}/config`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updatedConfig)
         });
         if (!res.ok) throw new Error("Failed to save config");
         setOriginalConfig(JSON.stringify(updatedConfig));
         setConfig(updatedConfig); // Also update live state
         await fetchInstanceMods(selectedId, true);
         if (selectedId) fetchFileList(selectedId, "data/mods");

         if (shouldRestartAfter) {
            setIsEditModalOpen(false); // Exit to main screen
            handleRestart(selectedId);
         } else {
            await showAlert("Changes saved explicitly.", "Configuration");
         }

      } catch (e: any) {
         await showAlert("Save Error: " + e.message, "Save Failed");
      } finally {
         setIsSaving(true); // Small delay to prevent double save
         setTimeout(() => setIsSaving(false), 500);
      }
   };

   const handleRestart = async (id: string) => {
      try {
         setStatuses((prev: Record<string, InstanceStatus>) => ({
            ...prev,
            [id]: { ...prev[id], is_running: true, is_ready: false, startup_status: "Restarting...", startup_percent: 20 }
         }));
         // We use stop then start for a clean reload of compose
         await fetch(`/api/instances/${id}/stop`, { method: "POST" });
         setStatuses((prev: Record<string, InstanceStatus>) => ({
            ...prev,
            [id]: { ...prev[id], is_running: true, is_ready: false, startup_status: "Starting...", startup_percent: 40 }
         }));
         await fetch(`/api/instances/${id}/start`, { method: "POST" });

         // Modal closure already handled by handleSaveConfig if coming from there

         setTimeout(() => {
            fetchStatus(id);
         }, 2000);
      } catch (e) {
         console.error("Restart failed", e);
         fetchStatus(id);
      }
   };

   const fetchFileList = async (id: string | null, path: string = ".") => {
      setIsFilesLoading(true);
      try {
         const url = id
            ? `/api/instances/${id}/files?path=${encodeURIComponent(path)}`
            : `/api/files?path=${encodeURIComponent(path)}`;
         const res = await fetch(url);
         const data = await res.json();
         setFileList(data.items || []);
         setCurrentFilePath(data.path);
      } catch (e) {
         console.error("Failed to fetch files", e);
      } finally {
         setIsFilesLoading(false);
      }
   };

   const handleVersionClick = async (vId: string, environment: Record<string, string> = config.environment) => {
      if (vId === environment["VERSION"]) return;

      setPendingVersion(vId);
      setIsVersionModalOpen(true);
      setIsCheckingCompatibility(true);
      setCompatibility({ compatible: [], incompatible: [] });

      try {
         const loader = environment["TYPE"] || "VANILLA";
         const modrinthIds = (environment["MODRINTH_PROJECTS"] || "").split(',').filter(Boolean);

         const res = await fetch("/api/mods/check-compatibility", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
               mc_version: vId,
               loader: loader,
               modrinth_ids: modrinthIds
            })
         });
         const data = await res.json();
         setCompatibility(data);
      } catch (e) {
         console.error("Compatibility check failed", e);
      } finally {
         setIsCheckingCompatibility(false);
      }
   };

   // Newest stable release in the Mojang manifest (ordered newest first).
   const latestRelease: { id: string; type: string } | undefined = mcVersions.find((v: { type: string }) => v.type === 'release');

   // Compare by manifest position rather than parsing version strings, so year-based ids (e.g. 26.1) order correctly.
   const isOutdatedRelease = (version?: string) => {
      if (!version || !latestRelease) return false;
      const idx = mcVersions.findIndex((v: { id: string }) => v.id === version);
      const latestIdx = mcVersions.indexOf(latestRelease);
      return idx > latestIdx;
   };

   const openVersionUpdate = async () => {
      if (!selectedId || !latestRelease) return;
      setIsGlobalBrowser(false);
      setIsEditModalOpen(true);
      setEditTab("version");
      fetchInstanceMods(selectedId, true);
      const data = await fetchConfig(selectedId);
      if (data?.environment) {
         handleVersionClick(latestRelease.id, data.environment);
      }
   };

   const applyVersionChange = () => {
      const newEnv = { ...config.environment };
      newEnv["VERSION"] = pendingVersion;

      if (updateMods) {
         // Keep only compatible ones
         const compModrinth = compatibility.compatible.filter((m: any) => m.provider === 'modrinth').map((m: any) => m.id);

         newEnv["MODRINTH_PROJECTS"] = compModrinth.join(',');
      }

      if (updateLoader) {
         // Clear loader version to pull latest for new MC version
         newEnv["LOADER_VERSION"] = "";
      }

      setConfig(prev => ({ ...prev, environment: newEnv }));
      setIsVersionModalOpen(false);
   };

   const handleOpenFile = async (id: string | null, path: string, name: string) => {
      try {
         const url = id
            ? `/api/instances/${id}/file/content?path=${encodeURIComponent(path)}`
            : `/api/file/content?path=${encodeURIComponent(path)}`;
         const res = await fetch(url);
         if (!res.ok) throw new Error("Could not read file");
         const data = await res.json();
         setViewingFile({ name, content: data.content });
      } catch (e: any) {
         await showAlert(e.message, "File Error");
      }
   };

   const getFileApiBase = () => {
      const id = isGlobalBrowser ? null : selectedId;
      return id ? `/api/instances/${id}/files` : `/api/files`;
   };

   const refreshFiles = async () => {
      const instanceId = isGlobalBrowser ? null : selectedId;
      await fetchFileList(instanceId, currentFilePath);
   };

   const handleCreateFileOrFolder = async (name: string, is_dir: boolean) => {
      if (!name || !name.trim()) {
         setInlineEditing(null);
         return;
      }
      const base = getFileApiBase();
      try {
         const res = await fetch(`${base}/create`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: currentFilePath, name: name.trim(), is_dir })
         });
         if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: "Failed to create" }));
            throw new Error(err.detail || "Failed to create");
         }
         setInlineEditing(null);
         await refreshFiles();
      } catch (err: any) {
         await showAlert(err.message, "Create Error");
      }
   };

   const handleRenameFileOrFolder = async (oldName: string, newName: string) => {
      if (!newName || !newName.trim() || oldName === newName.trim()) {
         setInlineEditing(null);
         return;
      }
      const base = getFileApiBase();
      const oldPath = currentFilePath === "." ? oldName : `${currentFilePath}/${oldName}`;
      try {
         const res = await fetch(`${base}/rename`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: oldPath, new_name: newName.trim() })
         });
         if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: "Failed to rename" }));
            throw new Error(err.detail || "Failed to rename");
         }
         setInlineEditing(null);
         await refreshFiles();
      } catch (err: any) {
         await showAlert(err.message, "Rename Error");
      }
   };

   const handleDeleteFilesOrFolders = async (names: string[]) => {
      if (!names || names.length === 0) return;
      const msg = names.length === 1 
         ? `Are you sure you want to delete "${names[0]}"?`
         : `Are you sure you want to delete ${names.length} items?`;
      const confirmed = await showConfirm(msg, "Delete");
      if (!confirmed) return;

      const base = getFileApiBase();
      const paths = names.map(n => currentFilePath === "." ? n : `${currentFilePath}/${n}`);
      try {
         const res = await fetch(`${base}/delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paths })
         });
         if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: "Failed to delete" }));
            throw new Error(err.detail || "Failed to delete");
         }
         setSelectedFileNames([]);
         await refreshFiles();
      } catch (err: any) {
         await showAlert(err.message, "Delete Error");
      }
   };

   const handleDownloadFilesOrFolders = (names: string[]) => {
      if (!names || names.length === 0) return;
      const base = getFileApiBase();
      if (names.length === 1) {
         const path = currentFilePath === "." ? names[0] : `${currentFilePath}/${names[0]}`;
         window.open(`${base}/download?path=${encodeURIComponent(path)}`, "_blank");
      } else {
         const paths = names.map(n => currentFilePath === "." ? n : `${currentFilePath}/${n}`);
         window.open(`${base}/download?paths=${encodeURIComponent(paths.join(","))}`, "_blank");
      }
   };

   const handleExecuteMoveOrCopy = async (
      action: "cut" | "copy",
      sourceRelPaths: string[],
      destDir: string,
      strategy: "fail" | "overwrite" | "rename_new" = "fail"
   ) => {
      const base = getFileApiBase();
      const endpoint = action === "cut" ? `${base}/move` : `${base}/copy`;
      try {
         const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
               source_paths: sourceRelPaths,
               destination_dir: destDir,
               collision_strategy: strategy
            })
         });

         if (res.status === 409) {
            const data = await res.json().catch(() => ({ detail: "Conflict detected" }));
            setFileConflictModal({
               title: "File Conflict",
               message: `One or more files already exist in destination:\n${data.detail}`,
               conflicts: sourceRelPaths,
               onResolve: async (resolvedStrategy) => {
                  setFileConflictModal(null);
                  if (resolvedStrategy === "cancel") return;
                  await handleExecuteMoveOrCopy(action, sourceRelPaths, destDir, resolvedStrategy);
               }
            });
            return;
         }

         if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: "Operation failed" }));
            throw new Error(err.detail || "Operation failed");
         }

         if (action === "cut") {
            setFileClipboard(null);
         }
         setSelectedFileNames([]);
         await refreshFiles();
      } catch (err: any) {
         await showAlert(err.message, `${action === "cut" ? "Move" : "Copy"} Error`);
      }
   };

   const handlePasteClipboard = async () => {
      if (!fileClipboard || fileClipboard.files.length === 0) return;
      const sourcePaths = fileClipboard.files.map(f =>
         fileClipboard.sourceDir === "." ? f : `${fileClipboard.sourceDir}/${f}`
      );
      await handleExecuteMoveOrCopy(fileClipboard.action, sourcePaths, currentFilePath, "fail");
   };

   const handleUploadFileList = async (files: FileList | File[], targetFolder: string = currentFilePath) => {
      if (!files || files.length === 0) return;
      const base = getFileApiBase();
      const formData = new FormData();
      formData.append("path", targetFolder);
      formData.append("collision_strategy", "overwrite");
      for (let i = 0; i < files.length; i++) {
         formData.append("files", files[i]);
      }
      try {
         setIsFilesLoading(true);
         const res = await fetch(`${base}/upload`, {
            method: "POST",
            body: formData
         });
         if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: "Upload failed" }));
            throw new Error(err.detail || "Upload failed");
         }
         await refreshFiles();
      } catch (err: any) {
         await showAlert(err.message, "Upload Error");
      } finally {
         setIsFilesLoading(false);
      }
   };

   useEffect(() => {
      const handleGlobalClick = () => {
         setFileContextMenu(null);
      };
      window.addEventListener('click', handleGlobalClick);
      return () => window.removeEventListener('click', handleGlobalClick);
   }, []);

   useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
         const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
         if (tag === 'input' || tag === 'textarea' || tag === 'select') {
            if (e.key === 'Escape') {
               setInlineEditing(null);
               setFileContextMenu(null);
            }
            return;
         }

         if (editTab !== "files") return;

         if (e.key === 'Escape') {
            setFileContextMenu(null);
            setInlineEditing(null);
         } else if (e.key === 'Delete') {
            if (selectedFileNames.length > 0) {
               e.preventDefault();
               handleDeleteFilesOrFolders(selectedFileNames);
            }
         } else if (e.key === 'F2') {
            if (selectedFileNames.length === 1) {
               e.preventDefault();
               setInlineEditing({ type: 'rename', targetName: selectedFileNames[0], value: selectedFileNames[0] });
            }
         } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
            if (selectedFileNames.length > 0) {
               e.preventDefault();
               setFileClipboard({ action: 'copy', files: [...selectedFileNames], sourceDir: currentFilePath, instanceId: isGlobalBrowser ? null : selectedId });
            }
         } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
            if (selectedFileNames.length > 0) {
               e.preventDefault();
               setFileClipboard({ action: 'cut', files: [...selectedFileNames], sourceDir: currentFilePath, instanceId: isGlobalBrowser ? null : selectedId });
            }
         } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
            if (fileClipboard && fileClipboard.files.length > 0) {
               e.preventDefault();
               handlePasteClipboard();
            }
         } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            if (fileList.length > 0) {
               e.preventDefault();
               setSelectedFileNames(fileList.map(f => f.name));
            }
         }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
   }, [editTab, selectedFileNames, fileClipboard, fileList, currentFilePath, isGlobalBrowser, selectedId]);

   // Modpack instances run as TYPE=MODRINTH; mod searches need the pack's underlying loader instead
   const getInstanceModLoader = (env: Record<string, string>) =>
      env["TYPE"] === "MODRINTH" ? (env["ISOPOD_MODPACK_LOADER"] || "") : (env["TYPE"] || "");

   const handleModSearch = async (query: string, provider: string, forceVersion?: string, forceLoader?: string) => {
      setIsModSearching(true);
      try {
         // Default to what's in the search inputs, or fallback to instance configuration
         let mc_version = forceVersion !== undefined ? forceVersion : (modSearchVersion || (config?.environment ? (config.environment["VERSION"] || "") : ""));
         let raw_loader = forceLoader !== undefined ? forceLoader : (modSearchLoader || (config?.environment ? getInstanceModLoader(config.environment) : ""));

         // Fix potential "undefined" literals
         if (mc_version === "undefined") mc_version = "";
         if (raw_loader === "undefined") raw_loader = "";

         const res = await fetch(`/api/mods/search/${provider}?q=${encodeURIComponent(query)}&mc_version=${mc_version}&loader=${raw_loader}`);
         if (!res.ok) throw new Error(`Server returned ${res.status}`);
         const data = await res.json();
         setModSearchResults(data);
         if (Array.isArray(data)) {
            setModMetaCache(prev => {
               const updated = { ...prev };
               for (const item of data) {
                  if (item.id) {
                     updated[item.id.toLowerCase()] = {
                        name: item.name,
                        icon_url: item.icon_url,
                        latest_version: item.latest_version
                     };
                  }
               }
               return updated;
            });
         }
      } catch (e: any) {
         console.error("Mod search failed", e);
         await showAlert("Search Error: " + e.message, "Search Failed");
      } finally {
         setIsModSearching(false);
      }
   };

   const fetchInstalledModsMeta = async () => {
      if (!config || !config.environment) return;
      const mIdsEnv = config.environment["MODRINTH_PROJECTS"] || "";
      const modrinthModpack = config.environment["MODRINTH_MODPACK"] || "";

      if (!mIdsEnv && !modrinthModpack) {
         setInstalledModsMeta([]);
         return;
      }

      setIsMetaLoading(true);
      try {
         const res = await fetch(`/api/mods/metadata?modrinth_ids=${mIdsEnv}&modrinth_modpack=${modrinthModpack}`);
         const data = await res.json();
         setInstalledModsMeta(data);
         if (Array.isArray(data)) {
            setModMetaCache(prev => {
               const updated = { ...prev };
               for (const item of data) {
                  if (item.id) {
                     updated[item.id.toLowerCase()] = {
                        name: item.name,
                        icon_url: item.icon_url,
                        latest_version: item.latest_version
                     };
                  }
               }
               return updated;
            });
         }

         // Auto-normalize Modrinth IDs (resolve UUIDs to slugs)
         const currentListM = (config.environment["MODRINTH_PROJECTS"] || "").split(',').map(s => s.trim()).filter(Boolean);
         if (currentListM.length > 0) {
            const normalizedM = currentListM.map(id => {
               const match = data.find((m: any) => m.provider === 'modrinth' && (m.id === id || m.requested_id === id));
               return match && !match.unknown ? match.id : id;
            });
            const uniqM = [...new Set(normalizedM)];
            if (uniqM.join(',') !== currentListM.join(',')) {
               setConfig(prev => ({
                  ...prev,
                  environment: { ...prev.environment, MODRINTH_PROJECTS: uniqM.join(',') }
               }));
            }
         }
      } catch (e) {
         console.error("Failed to fetch mod metadata", e);
      } finally {
         setIsMetaLoading(false);
      }
   };

   const fetchInstanceMods = async (instId?: string, forceReset = false) => {
      const id = instId || selectedId;
      if (!id) return;
      setIsInstanceModsLoading(true);
      try {
         const res = await fetch(`/api/instances/${id}/mods`);
         if (res.ok) {
            const data: InstanceModItem[] = await res.json();
            setInstanceMods(prev => {
               if (forceReset) return data;
               const pending = prev.filter(m => m.source === "pending");
               if (pending.length === 0) return data;
               const dataIds = new Set(data.map(m => m.id.toLowerCase()));
               const remainingPending = pending.filter(p => !dataIds.has(p.id.toLowerCase()));
               return [...remainingPending, ...data];
            });
            setSelectedModFilename(prev => {
               if (prev && data.some(m => m.filename === prev)) return prev;
               return data.length > 0 ? data[0].filename : null;
            });
         }
      } catch (e) {
         console.error("Failed to fetch instance mods", e);
      } finally {
         setIsInstanceModsLoading(false);
      }
   };

   const handleCheckUpdatesAndSyncMods = async () => {
      if (!selectedId) return;
      setIsInstanceModsLoading(true);
      try {
         await fetch(`/api/instances/${selectedId}/mods/sync`, { method: "POST" });
         await fetchInstanceMods(selectedId);
      } catch (e) {
         console.error("Error syncing mods", e);
      } finally {
         setIsInstanceModsLoading(false);
      }
   };

   const toggleMod = async (mod: InstanceModItem, targetEnabled: boolean) => {
      if (!selectedId) return;

      // Optimistic UI update
      setInstanceMods(prev => prev.map(m => {
         if (m.filename === mod.filename || m.id === mod.id) {
            return {
               ...m,
               enabled: targetEnabled,
               filename: targetEnabled
                  ? m.filename.replace(/\.disabled$/, '')
                  : (m.filename.endsWith('.disabled') ? m.filename : `${m.filename}.disabled`)
            };
         }
         return m;
      }));

      if (mod.source === "pending") {
         if (config.environment) {
            const updateEnvLists = (enKey: string, disKey: string) => {
               const enList = (config.environment[enKey] || "").split(',').map(s => s.trim()).filter(Boolean);
               const disList = (config.environment[disKey] || "").split(',').map(s => s.trim()).filter(Boolean);
               const targetId = mod.id.toLowerCase();
               const matchInEn = enList.find(x => x.toLowerCase() === targetId);
               const matchInDis = disList.find(x => x.toLowerCase() === targetId);
               const matched = matchInEn || matchInDis || mod.id;
               if (matched) {
                  let newEn = enList.filter(x => x.toLowerCase() !== targetId);
                  let newDis = disList.filter(x => x.toLowerCase() !== targetId);
                  if (targetEnabled) { newEn.push(matched); } else { newDis.push(matched); }
                  return { [enKey]: newEn.join(','), [disKey]: newDis.join(',') };
               }
               return null;
            };
            const mUpdates = updateEnvLists("MODRINTH_PROJECTS", "MODRINTH_DISABLED");
            if (mUpdates) {
               setConfig(prev => ({
                  ...prev,
                  environment: { ...prev.environment, ...(mUpdates || {}) }
               }));
            }
         }
         return;
      }

      try {
         const res = await fetch(`/api/instances/${selectedId}/mods/toggle`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
               filename: mod.filename,
               mod_id: mod.id,
               enabled: targetEnabled
            })
         });
         if (!res.ok) throw new Error("Failed to toggle mod");

         // Update config.environment in memory if available
         if (config.environment) {
            const updateEnvLists = (enKey: string, disKey: string) => {
               const enList = (config.environment[enKey] || "").split(',').map(s => s.trim()).filter(Boolean);
               const disList = (config.environment[disKey] || "").split(',').map(s => s.trim()).filter(Boolean);
               const targetId = mod.id.toLowerCase();

               const matchInEn = enList.find(x => x.toLowerCase() === targetId);
               const matchInDis = disList.find(x => x.toLowerCase() === targetId);
               const matched = matchInEn || matchInDis || (mod.provider === 'modrinth' ? mod.id : null);

               if (matched) {
                  let newEn = enList.filter(x => x.toLowerCase() !== targetId);
                  let newDis = disList.filter(x => x.toLowerCase() !== targetId);
                  if (targetEnabled) {
                     newEn.push(matched);
                  } else {
                     newDis.push(matched);
                  }
                  return { [enKey]: newEn.join(','), [disKey]: newDis.join(',') };
               }
               return null;
            };

            const mUpdates = updateEnvLists("MODRINTH_PROJECTS", "MODRINTH_DISABLED");
            if (mUpdates) {
               setConfig(prev => ({
                  ...prev,
                  environment: {
                     ...prev.environment,
                     ...(mUpdates || {})
                  }
               }));
            }
         }

         fetchInstanceMods(selectedId);
      } catch (e: any) {
         console.error("Error toggling mod", e);
         await showAlert("Failed to toggle mod: " + e.message, "Error");
         fetchInstanceMods(selectedId);
      }
   };

   const deleteMod = async (mod: InstanceModItem) => {
      if (!selectedId) return;
      const confirmed = await showConfirm(`Are you sure you want to remove "${mod.name}"? This will delete the mod file.`, "Remove Mod");
      if (!confirmed) return;

      if (mod.source === "pending") {
         setInstanceMods(prev => prev.filter(m => m.filename !== mod.filename && m.id !== mod.id));
         if (selectedModFilename === mod.filename) {
            setSelectedModFilename(null);
         }
         if (config.environment) {
            setConfig(prev => {
               const env = { ...prev.environment };
               for (const key of ["MODRINTH_PROJECTS", "MODRINTH_DISABLED"]) {
                  if (env[key]) {
                     const items = env[key].split(',').map(s => s.trim()).filter(Boolean);
                     const filtered = items.filter(x => x.toLowerCase() !== mod.id.toLowerCase() && x.toLowerCase() !== mod.filename.toLowerCase());
                     env[key] = filtered.join(',');
                  }
               }
               return { ...prev, environment: env };
            });
         }
         return;
      }

      try {
         const res = await fetch(`/api/instances/${selectedId}/mods/delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
               filename: mod.filename,
               mod_id: mod.id
            })
         });
         if (!res.ok) throw new Error("Failed to delete mod");

         setInstanceMods(prev => prev.filter(m => m.filename !== mod.filename && m.id !== mod.id));
         if (selectedModFilename === mod.filename) {
            setSelectedModFilename(null);
         }

         if (config.environment) {
            setConfig(prev => {
               const env = { ...prev.environment };
               for (const key of ["MODRINTH_PROJECTS", "MODRINTH_DISABLED"]) {
                  if (env[key]) {
                     const items = env[key].split(',').map(s => s.trim()).filter(Boolean);
                     const filtered = items.filter(x => x.toLowerCase() !== mod.id.toLowerCase() && x.toLowerCase() !== mod.filename.toLowerCase());
                     env[key] = filtered.join(',');
                  }
               }
               return { ...prev, environment: env };
            });
         }

         fetchInstanceMods(selectedId);
      } catch (e: any) {
         console.error("Error deleting mod", e);
         await showAlert("Failed to remove mod: " + e.message, "Error");
      }
   };

   const handleModUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!selectedId || !e.target.files || e.target.files.length === 0) return;
      const file = e.target.files[0];
      const formData = new FormData();
      formData.append("file", file);

      try {
         const res = await fetch(`/api/instances/${selectedId}/mods/upload`, {
            method: "POST",
            body: formData
         });
         if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || "Upload failed");
         }
         await fetchInstanceMods(selectedId);
         await showAlert(`Mod "${file.name}" uploaded successfully!`, "Mod Added");
      } catch (e: any) {
         console.error("Upload error", e);
         await showAlert("Failed to upload mod: " + e.message, "Upload Error");
      } finally {
         if (modFileInputRef.current) {
            modFileInputRef.current.value = "";
         }
      }
   };

   const exportModsList = () => {
      if (instanceMods.length === 0) {
         showAlert("No mods installed to export.", "Export List");
         return;
      }
      const text = instanceMods
         .map(m => `${m.name} (${m.version || 'unknown'}) [${m.enabled ? 'Enabled' : 'Disabled'}]`)
         .join('\n');
      navigator.clipboard.writeText(text);
      showAlert(`Copied list of ${instanceMods.length} mods to clipboard!`, "Export List");
   };

   const filteredInstanceMods = useMemo(() => {
      if (!modFilterQuery.trim()) return instanceMods;
      const q = modFilterQuery.toLowerCase();
      return instanceMods.filter(m =>
         m.name.toLowerCase().includes(q) ||
         m.id.toLowerCase().includes(q) ||
         m.filename.toLowerCase().includes(q) ||
         (m.version && m.version.toLowerCase().includes(q))
      );
   }, [instanceMods, modFilterQuery]);

   const selectedMod = useMemo(() => {
      return instanceMods.find(m => m.filename === selectedModFilename) || null;
   }, [instanceMods, selectedModFilename]);

   const handleResourcePackSearch = async (query: string, provider: string) => {
      setIsResourcePackSearching(true);
      try {
         const mc_version = config?.environment ? (config.environment["VERSION"] || "") : "";
         const res = await fetch(`/api/mods/search/${provider}?q=${encodeURIComponent(query)}&class_type=resourcepack&mc_version=${mc_version}`);
         if (!res.ok) throw new Error(`Server returned ${res.status}`);
         const data = await res.json();
         setResourcePackResults(data);
      } catch (e: any) {
         console.error("Resource pack search failed", e);
      } finally {
         setIsResourcePackSearching(false);
      }
   };

   const fetchInstalledResourcePacksMeta = async () => {
      if (!config || !config.environment) return;
      const mIdsEnv = config.environment["RESOURCE_PACKS_MODRINTH"] || "";
      const cIdsEnv = config.environment["RESOURCE_PACKS_CF"] || "";
      if (!mIdsEnv && !cIdsEnv) {
         setInstalledResourcePacksMeta([]);
         return;
      }

      setIsResourcePackMetaLoading(true);
      try {
         const res = await fetch(`/api/mods/metadata?modrinth_ids=${mIdsEnv}&cf_ids=${cIdsEnv}`);
         const data = await res.json();
         setInstalledResourcePacksMeta(data);

         // Auto-normalize
         const currentListM = (config.environment["RESOURCE_PACKS_MODRINTH"] || "").split(',').map(s => s.trim()).filter(Boolean);
         const normalizedM = currentListM.map(id => {
            const match = data.find((m: any) => m.provider === 'modrinth' && (m.id === id || m.requested_id === id));
            return match && !match.unknown ? match.id : id;
         });
         const uniqM = [...new Set(normalizedM)];
         if (uniqM.join(',') !== currentListM.join(',')) {
            setConfig(prev => ({
               ...prev,
               environment: { ...prev.environment, RESOURCE_PACKS_MODRINTH: uniqM.join(',') }
            }));
         }
      } catch (e) {
         console.error("Failed to fetch resource pack metadata", e);
      } finally {
         setIsResourcePackMetaLoading(false);
      }
   };

   const checkSystemUpdates = async (force: boolean = false) => {
      setIsCheckingUpdates(true);
      try {
         const res = await fetch(`/api/system/check-updates?force=${force}`);
         const data = await res.json();
         setUpdateInfo(data);
      } catch (e) {
         console.error("Failed to check for updates", e);
      } finally {
         setIsCheckingUpdates(false);
      }
   };

   const handleSendCommand = async (id: string, cmd: string) => {
      if (!cmd.trim()) return;
      setIsExecuting(true);

      // Add to history if not duplicate of last
      setCommandHistory(prev => {
         if (prev[prev.length - 1] === cmd) return prev;
         return [...prev, cmd];
      });
      setHistoryIndex(-1);
      setCommandDraft("");

      try {
         const res = await fetch(`/api/instances/${id}/command`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command: cmd })
         });
         const data = await res.json();

         const entry = `\n> ${cmd}\n${data.output}`;
         const currentLogs = serverLogs[id] || "";
         const lines = currentLogs.split('\n').filter(Boolean);
         const lastLine = lines[lines.length - 1] || "";

         setManualLogs(prev => ({
            ...prev,
            [id]: [...(prev[id] || []), { anchor: lastLine, content: entry }]
         }));
         setConsoleCommand("");
      } catch (e) {
         console.error("Failed to send command", e);
      } finally {
         setIsExecuting(false);
      }
   };

   const performSystemUpdate = async () => {
      const confirmed = await showConfirm("This will pull the latest release, rebuild/restart the container, and update Isopod. All server instances and data remain safe. Proceed?", "Update Isopod");
      if (!confirmed) return;

      setIsSettingsModalOpen(false);
      setIsUpdatingSystem(true);
      setUpdateProgressState({
         stage: "initiating",
         progress: 15,
         message: "Initiating update sequence with server..."
      });

      try {
         const res = await fetch("/api/system/update", { method: "POST" });
         if (!res.ok) {
            const errData = await res.json().catch(() => ({ detail: "Failed to trigger update" }));
            throw new Error(errData.detail || "Failed to trigger update");
         }

         setUpdateProgressState({
            stage: "rebuilding",
            progress: 35,
            message: "Pulling latest changes and rebuilding container..."
         });

         // Record update flag in localStorage so when page reloads, it checks version & shows success toast
         localStorage.setItem("isopod_just_updated", "true");
         localStorage.setItem("isopod_target_version", updateInfo?.latest_version || "");

         // Begin active polling
         let attempts = 0;
         const maxAttempts = 60; // 60 * 1.5s = 90s
         let serverDropped = false;

         // Progress animation incrementer
         const progressInterval = setInterval(() => {
            setUpdateProgressState(prev => {
               if (!prev || prev.stage === "success" || prev.stage === "error") return prev;
               const nextProgress = Math.min(prev.progress + 1, 85);
               return { ...prev, progress: nextProgress };
            });
         }, 1000);

         // Wait 3 seconds to give the backend time to initiate shutdown/rebuild
         await new Promise(r => setTimeout(r, 3000));
         setUpdateProgressState(prev => prev ? {
            ...prev,
            stage: "waiting_reconnect",
            progress: 55,
            message: "Container restarting. Waiting for application to come back online..."
         } : null);

         const pollInterval = setInterval(async () => {
            attempts++;
            try {
               const controller = new AbortController();
               const timeoutId = setTimeout(() => controller.abort(), 2000);
               const pingRes = await fetch("/api/system/info", { signal: controller.signal });
               clearTimeout(timeoutId);

               if (pingRes.ok) {
                  const info = await pingRes.json();
                  const targetVer = updateInfo?.latest_version;
                  const isTarget = Boolean(targetVer && info.version === targetVer);
                  if (serverDropped || isTarget) {
                     clearInterval(pollInterval);
                     clearInterval(progressInterval);

                     setUpdateProgressState({
                        stage: "success",
                        progress: 100,
                        message: `Update complete! Running ${info.version || 'latest version'}. Refreshing...`
                     });

                     setTimeout(() => {
                        window.location.reload();
                     }, 1500);
                     return;
                  }
               }
            } catch (err) {
               serverDropped = true;
               setUpdateProgressState(prev => prev ? {
                  ...prev,
                  progress: Math.max(prev.progress, 70),
                  message: "Rebuilding and starting updated container..."
               } : null);
            }

            if (attempts >= maxAttempts) {
               clearInterval(pollInterval);
               clearInterval(progressInterval);
               setUpdateProgressState(prev => prev ? {
                  ...prev,
                  stage: "error",
                  progress: 85,
                  message: "The restart is taking longer than expected.",
                  errorDetails: "The container may still be compiling or starting. You can manually reload the page or check your docker logs."
               } : null);
            }
         }, 1500);

      } catch (e: any) {
         setUpdateProgressState({
            stage: "error",
            progress: 0,
            message: "Failed to initiate update",
            errorDetails: e.message || "Could not connect to the update service."
         });
         setIsUpdatingSystem(false);
      }
   };

   const handleAddMod = (res: any, provider: string = "modrinth") => {
      const envKey = "MODRINTH_PROJECTS";
      const currentList: string = config.environment[envKey] || "";
      const currentItems = currentList.split(',').map(s => s.trim()).filter(Boolean);
      if (!currentItems.includes(res.id)) {
         const newList = [...currentItems, res.id].join(',');
         setConfig(prev => ({
            ...prev,
            environment: { ...prev.environment, [envKey]: newList }
         }));
      }

      setModMetaCache(prev => ({
         ...prev,
         [res.id.toLowerCase()]: {
            name: res.name || res.id,
            icon_url: res.icon_url || null,
            latest_version: res.latest_version || "-"
         },
         [(res.name || res.id).toLowerCase()]: {
            name: res.name || res.id,
            icon_url: res.icon_url || null,
            latest_version: res.latest_version || "-"
         }
      }));

      const newModItem: InstanceModItem = {
         filename: `${res.id}.jar`,
         id: res.id,
         name: res.name || res.id,
         version: res.latest_version || "-",
         enabled: true,
         size: 0,
         modified: Date.now() / 1000,
         modified_str: "Pending Save",
         icon_url: res.icon_url || null,
         summary: res.summary || null,
         url: res.url || (provider === 'modrinth' ? `https://modrinth.com/mod/${res.id}` : null),
         provider: provider,
         source: "pending"
      };

      setInstanceMods(prev => {
         const exists = prev.find(m => m.id.toLowerCase() === res.id.toLowerCase());
         if (exists) {
            return prev.map(m => m.id.toLowerCase() === res.id.toLowerCase() ? { ...m, enabled: true, icon_url: m.icon_url || res.icon_url, name: m.name || res.name } : m);
         }
         return [newModItem, ...prev];
      });
   };

   const addWithDependencies = async (res: any, provider: string = "modrinth") => {
      const envKey = "MODRINTH_PROJECTS";
      const currentList: string = config.environment[envKey] || "";
      const ids = currentList.split(',').map(s => s.trim()).filter(Boolean);

      let toAdd = [res.id];
      try {
         // Fetch dependencies
         const depRes = await fetch(`/api/mods/dependencies?provider=${provider}&project_id=${res.id}`);
         if (depRes.ok) {
            const depIds: string[] = await depRes.json();
            toAdd = [res.id, ...depIds];
         }
      } catch (e) {
         console.error("Failed to fetch dependencies", e);
      }

      const newIds = [...new Set([...ids, ...toAdd])].join(',');
      setConfig(prev => ({
         ...prev,
         environment: { ...prev.environment, [envKey]: newIds }
      }));

      setModMetaCache(prev => ({
         ...prev,
         [res.id.toLowerCase()]: {
            name: res.name || res.id,
            icon_url: res.icon_url || null,
            latest_version: res.latest_version || "-"
         },
         [(res.name || res.id).toLowerCase()]: {
            name: res.name || res.id,
            icon_url: res.icon_url || null,
            latest_version: res.latest_version || "-"
         }
      }));

      setInstanceMods(prev => {
         const existingIds = new Set(prev.map(m => m.id.toLowerCase()));
         const additions: InstanceModItem[] = [];
         for (const id of toAdd) {
            if (!existingIds.has(id.toLowerCase())) {
               additions.push({
                  filename: `${id}.jar`,
                  id: id,
                  name: id === res.id ? (res.name || id) : id,
                  version: id === res.id ? (res.latest_version || "-") : "-",
                  enabled: true,
                  size: 0,
                  modified: Date.now() / 1000,
                  modified_str: "Pending Save",
                  icon_url: id === res.id ? (res.icon_url || null) : null,
                  summary: id === res.id ? (res.summary || null) : null,
                  url: id === res.id ? (res.url || null) : null,
                  provider: provider,
                  source: "pending"
               });
               existingIds.add(id.toLowerCase());
            }
         }
         return [...additions, ...prev];
      });
   };

   const closeEditModal = () => {
      if (originalConfig) {
         try {
            setConfig(JSON.parse(originalConfig));
         } catch (e) {
            console.error("Failed to restore original config", e);
         }
      }
      setInstanceMods([]);
      if (selectedId) {
         fetchInstanceMods(selectedId, true);
      }
      setModListView("list");
      setIsEditModalOpen(false);
   };

   const openEditModal = () => {
      if (!selectedId) return;
      setIsGlobalBrowser(false);
      setIsEditModalOpen(true);
      setEditTab("logs");
      setAutoScrollEnabled(true);
      fetchLogs(selectedId);
      fetchConfig(selectedId);
      fetchMcVersions();
      fetchInstanceMods(selectedId, true);
   };

   const openSettings = () => {
      setOriginalGlobalSettings(JSON.stringify(globalSettings));
      setIsSettingsModalOpen(true);
      setSettingsTab("general");
   };

   const fetchGlobalSettings = async () => {
      try {
         const res = await fetch("/api/settings");
         if (res.ok) {
            const data = await res.json();
            setGlobalSettings(data);
            if (data.defaultMemory) setNewMemory(data.defaultMemory);
            if (data.defaultPort) setNewPort(data.defaultPort);
            if (data.defaultLoader) setSelectedAddLoader(data.defaultLoader.toUpperCase());
            if (data.defaultWhitelistEnabled !== undefined) setModalWhitelistEnabled(data.defaultWhitelistEnabled);
            if (data.defaultWhitelistUsers) setModalWhitelistUsers(data.defaultWhitelistUsers);
            if (data.showSnapshots !== undefined) {
               setVersionFilters(prev => ({ ...prev, Snapshots: !!data.showSnapshots }));
            }
         }
      } catch (e) {
         console.error("Failed to fetch settings", e);
      }
   };

   const handleSaveGlobalSettings = async () => {
      setIsSavingGlobal(true);
      let updatedSettings = { ...globalSettings };
      if (newWhitelistUser.trim() && !updatedSettings.defaultWhitelistUsers.includes(newWhitelistUser.trim())) {
         updatedSettings.defaultWhitelistUsers = [...updatedSettings.defaultWhitelistUsers, newWhitelistUser.trim()];
         setGlobalSettings(updatedSettings);
         setNewWhitelistUser("");
         setWhitelistPreview(null);
      }
      try {
         const res = await fetch("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updatedSettings)
         });
         if (!res.ok) throw new Error("Failed to save settings");
         setOriginalGlobalSettings(JSON.stringify(globalSettings));
         if (globalSettings.showSnapshots !== undefined) {
            setVersionFilters(prev => ({ ...prev, Snapshots: !!globalSettings.showSnapshots }));
         }
         if (globalSettings.defaultMemory) setNewMemory(globalSettings.defaultMemory);
         if (globalSettings.defaultPort) setNewPort(globalSettings.defaultPort);
         if (globalSettings.defaultLoader) setSelectedAddLoader(globalSettings.defaultLoader.toUpperCase());
         if (globalSettings.defaultWhitelistEnabled !== undefined) setModalWhitelistEnabled(globalSettings.defaultWhitelistEnabled);
         if (globalSettings.defaultWhitelistUsers) setModalWhitelistUsers(globalSettings.defaultWhitelistUsers);
      } catch (e) {
         console.error(e);
         await showAlert("Failed to save global settings", "Error");
      } finally {
         setIsSavingGlobal(false);
      }
   };

   useEffect(() => {
      const mode = (globalSettings.theme || "Dark").toLowerCase();
      document.documentElement.setAttribute('data-theme', mode === "light" ? "light" : "dark");
   }, [globalSettings.theme]);

   const handleExportSystemLogs = () => {
      const link = document.createElement("a");
      link.href = "/api/system/logs/export";
      link.download = "isopod_application_logs.txt";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
   };

   useEffect(() => {
      if (logKeepUpdating && scrollRef.current) {
         scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
   }, [serverLogs, manualLogs, editTab, logKeepUpdating]);

   useEffect(() => {
      fetchInstances();
      fetchMcVersions();
      fetchGlobalSettings();

      const justUpdated = localStorage.getItem("isopod_just_updated");
      if (justUpdated) {
         localStorage.removeItem("isopod_just_updated");
         const targetVer = localStorage.getItem("isopod_target_version") || "";
         localStorage.removeItem("isopod_target_version");
         setUpdateSuccessToast(targetVer ? `Successfully updated to ${targetVer}!` : "Successfully updated to the latest version!");
         setTimeout(() => setUpdateSuccessToast(null), 6000);
         checkSystemUpdates(true);
      } else {
         checkSystemUpdates();
      }
   }, []);

   useEffect(() => {
      if (!globalSettings.autoRefresh) return;
      const interval = setInterval(() => {
         instances.forEach((inst: Instance) => fetchStatus(inst.id));
      }, 5000);
      return () => clearInterval(interval);
   }, [instances, globalSettings.autoRefresh]);

   // Real-time Status & Progress Bar Polling in Editing View
   useEffect(() => {
      if (!isEditModalOpen || !selectedId || isGlobalBrowser) return;
      const id = selectedId;
      fetchStatus(id);

      const status = statuses[id];
      const isTransitioning =
         (status?.is_running && !status?.is_ready) ||
         status?.startup_status === "Stopping..." ||
         status?.startup_status === "Restarting...";

      // Poll faster (1.5s) during state transitions for smooth progress bar updates; 3s otherwise
      const pollRate = isTransitioning ? 1500 : 3000;
      const interval = setInterval(() => {
         fetchStatus(id);
      }, pollRate);

      return () => clearInterval(interval);
   }, [isEditModalOpen, selectedId, isGlobalBrowser, statuses[selectedId || ""]?.is_running, statuses[selectedId || ""]?.is_ready, statuses[selectedId || ""]?.startup_status]);

   // Live Logs Polling
   useEffect(() => {
      let interval: any;
      if (isEditModalOpen && editTab === "logs" && selectedId && logKeepUpdating) {
         interval = setInterval(() => {
            if (!isLogsLoading) {
               fetchLogs(selectedId);
            }
         }, 3000);
      }
      return () => interval && clearInterval(interval);
   }, [isEditModalOpen, editTab, selectedId, isLogsLoading, fetchLogs, logKeepUpdating]);

   // Sync mod search filters and instance mods when config is loaded or tab changed
   useEffect(() => {
      if (isEditModalOpen && config.environment) {
         const v = config.environment["VERSION"] || "";
         const l = getInstanceModLoader(config.environment);
         setModSearchVersion(v);
         setModSearchLoader(l);
         fetchInstalledModsMeta();
         fetchInstalledResourcePacksMeta();
         if (selectedId) {
            fetchInstanceMods(selectedId);
         }
         // Auto-browse when opening search
         handleModSearch("", modSearchProvider, v, l);
         handleResourcePackSearch("", resourcePackProvider);
      }
   }, [isEditModalOpen, config.environment]);

   useEffect(() => {
      if (isEditModalOpen && selectedId && editTab === "mods") {
         fetchInstanceMods(selectedId);
      }
   }, [isEditModalOpen, selectedId, editTab]);

   // Debounced Resource Pack search
   useEffect(() => {
      if (editTab === "resource-pack") {
         const timer = setTimeout(() => {
            handleResourcePackSearch(resourcePackQuery, resourcePackProvider);
         }, 500);
         return () => clearTimeout(timer);
      }
   }, [resourcePackQuery, resourcePackProvider, editTab]);

   // Debounced search
   useEffect(() => {
      if (modListView === "search") {
         const timer = setTimeout(() => {
            handleModSearch(modSearchQuery, modSearchProvider);
         }, 500);
         return () => clearTimeout(timer);
      }
   }, [modSearchQuery, modSearchProvider]);

   // Re-run modpack search when toggle changes
   useEffect(() => {
      if (isAddModalOpen && addTab === "modrinth") {
         handleModpackSearch(searchModpacks, addTab);
      }
   }, [onlyServerSideModpacks]);

   // Verify Minecraft User for Global Whitelist
   useEffect(() => {
      const timer = setTimeout(async () => {
         if (newWhitelistUser.length >= 3) {
            setIsVerifyingUser(true);
            try {
               const res = await fetch(`https://playerdb.co/api/player/minecraft/${newWhitelistUser}`);
               const data = await res.json();
               if (data.success) {
                  const p = { name: data.data.player.username, uuid: data.data.player.id };
                  setWhitelistPreview(p);
                  setSeenPlayers(prev => {
                     if (prev.find(x => x.uuid === p.uuid)) return prev;
                     return [...prev, p].slice(-20); // Keep last 20
                  });
               } else {
                  setWhitelistPreview(null);
               }
            } catch (e) { setWhitelistPreview(null); }
            finally { setIsVerifyingUser(false); }
         } else {
            setWhitelistPreview(null);
         }
      }, 600);
      return () => clearTimeout(timer);
   }, [newWhitelistUser]);

   const selectedInstance = instances.find(i => i.id === selectedId);
   const selectedStatus = selectedId ? statuses[selectedId] : null;

   const getMergedLogs = (id: string) => {
      const base = serverLogs[id] || "";
      const offset = clearedLogsOffset[id] || 0;
      const baseLogs = base.length >= offset ? base.slice(offset) : "";
      const manual = manualLogs[id] || [];
      if (manual.length === 0) return baseLogs;

      const lines = baseLogs.split('\n');
      const mergedLines = [...lines];
      manual.forEach(entry => {
         if (!entry.content) return;
         const anchorIdx = mergedLines.lastIndexOf(entry.anchor);
         if (anchorIdx !== -1) {
            mergedLines.splice(anchorIdx + 1, 0, ...entry.content.split('\n'));
         } else {
            mergedLines.push(...entry.content.split('\n'));
         }
      });
      return mergedLines.join('\n');
   };

   const logs = selectedId ? getMergedLogs(selectedId) : "";

   const displayLogLines = useMemo(() => {
      if (!logs) return [];
      const rawLines = logs.split('\n');
      if (isVerbose) return rawLines;
      const allowedPatterns = [
         /ERROR/, /FATAL/, /Exception/,
         /Loading \d+ mods/, / - /, / \\-- /,
         /Done \(/,
         /> /,
         /issued (server )?command/i,
         /joined the game/, /left the game/,
         /\[Server thread\/INFO\]: </,
         /Starting minecraft server version/,
         /\[Server thread\/INFO\]: \[(?!Rcon: Stopping)/
      ];
      return rawLines.filter(line => {
         if (line.includes('> ')) return true;
         return allowedPatterns.some(p => p.test(line));
      });
   }, [logs, isVerbose]);

   const matchingLineIndices = useMemo(() => {
      if (!logSearchQuery.trim()) return [];
      const q = logSearchQuery.toLowerCase();
      const indices: number[] = [];
      displayLogLines.forEach((line, idx) => {
         if (line.toLowerCase().includes(q)) {
            indices.push(idx);
         }
      });
      return indices;
   }, [displayLogLines, logSearchQuery]);

   const handleFindNext = () => {
      if (matchingLineIndices.length === 0) return;
      let nextIdx = currentMatchIndex;
      if (lastSearchedQueryRef.current !== logSearchQuery) {
         lastSearchedQueryRef.current = logSearchQuery;
         nextIdx = 0;
      } else {
         nextIdx = (currentMatchIndex + 1) % matchingLineIndices.length;
      }
      setCurrentMatchIndex(nextIdx);
      const targetLineIdx = matchingLineIndices[nextIdx];
      const el = document.getElementById(`log-line-${targetLineIdx}`);
      if (el) {
         el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
   };

   const handleScrollToBottom = () => {
      if (scrollRef.current) {
         scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
   };

   const handleCopyLogs = async () => {
      const textToCopy = displayLogLines.join('\n') || logs;
      if (!textToCopy) return;
      try {
         await navigator.clipboard.writeText(textToCopy);
         setLogCopied(true);
         setTimeout(() => setLogCopied(false), 2000);
      } catch (err) {
         console.error("Failed to copy logs:", err);
      }
   };

   const handleClearLogs = () => {
      if (!selectedId) return;
      const curLen = (serverLogs[selectedId] || "").length;
      setClearedLogsOffset(prev => ({ ...prev, [selectedId]: curLen }));
      setManualLogs(prev => ({ ...prev, [selectedId]: [] }));
   };

   // Fetch loader versions when selection changes (Add and Edit modals)
   useEffect(() => {
      if (isAddModalOpen && selectedAddLoader !== "VANILLA") {
         // Only fetch if we have an actual version ID or 'latest'
         const versionToFetch = selectedAddVersion === "latest" ? "" : selectedAddVersion;
         fetchLoaderVersions(selectedAddLoader, versionToFetch);
      } else if (isEditModalOpen && editTab === "loader" && config.environment) {
         const loader = config.environment["TYPE"];
         const mcVersion = config.environment["VERSION"] || "";
         if (loader && loader !== "VANILLA") {
            fetchLoaderVersions(loader, mcVersion === "latest" ? "" : mcVersion);
         } else {
            setLoaderVersions([]);
         }
      } else {
         setLoaderVersions([]);
      }
   }, [selectedAddLoader, selectedAddVersion, isAddModalOpen, isEditModalOpen, editTab, config.environment?.TYPE, config.environment?.VERSION]);


   const copyToClipboard = (text: string, id?: string) => {
      // Robust copy to clipboard
      const performCopy = () => {
         if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text);
         } else {
            // Fallback for non-secure contexts
            const textArea = document.createElement("textarea");
            textArea.value = text;
            textArea.style.position = "fixed";
            textArea.style.left = "-9999px";
            textArea.style.top = "0";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
               document.execCommand('copy');
               return Promise.resolve();
            } catch (err) {
               return Promise.reject(err);
            } finally {
               document.body.removeChild(textArea);
            }
         }
      };

      performCopy().then(() => {
         if (id) {
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 1500);
         }
      }).catch(err => {
         console.error('Failed to copy: ', err);
      });
   };


   return (
      <div className="flex h-screen bg-[#242424] text-[#E0E0E0] font-sans selection:bg-[#3E8ED0]/40 overflow-hidden">
         <div className="flex-1 flex flex-col">
            <header className="h-[52px] min-h-[52px] bg-[#3B3B3B] border-b border-[#1E1E1E] flex items-center px-4 gap-4 flex-shrink-0 shadow-sm z-10">
               <div className="flex items-center gap-2 mr-4 border-r border-[#4A4A4A] pr-4 py-1">
                  <img src="/logo.png" className="w-8 h-8 rounded" alt="Isopod Logo" />
                  <span className="text-xl font-bold tracking-tight text-white">Isopod</span>
               </div>
               <button
                  onClick={() => {
                     setIsAddModalOpen(true);
                     setNewIconFile(null);
                     setAddStep(1);
                     setAddTab("custom");
                     setNewName("");
                     setNewPort(globalSettings.defaultPort || "25565");
                     const defaultVer = mcVersions.find((v: any) => v.type === 'release')?.id || "latest";
                     setSelectedAddVersion(defaultVer);
                     const initialLoader = (globalSettings.defaultLoader || "VANILLA").toUpperCase();
                     setSelectedAddLoader(initialLoader);
                     setSelectedAddLoaderVersion("latest");
                     if (initialLoader !== "VANILLA") {
                        fetchLoaderVersions(initialLoader, defaultVer === "latest" ? "" : defaultVer);
                     }
                     setNewMemory(globalSettings.defaultMemory || "1G");
                     setModalWhitelistEnabled(globalSettings.defaultWhitelistEnabled ?? false);
                     setModalWhitelistUsers([...(globalSettings.defaultWhitelistUsers || [])]);
                     setModalWhitelistUserDraft("");
                     setSelectedModpack(null);
                     setImportFile(null);
                  }}
                  className="flex items-center gap-2 hover:bg-[#4A4A4A] px-3 py-1.5 rounded transition-colors text-sm font-medium"
               >
                  <Plus className="w-4 h-4 text-emerald-400" />
                  Add Instance
               </button>
               <button
                  onClick={() => {
                     setIsGlobalBrowser(true);
                     setEditTab("files");
                     setIsEditModalOpen(true);
                     fetchFileList(null);
                  }}
                  className="flex items-center gap-2 hover:bg-[#4A4A4A] px-3 py-1.5 rounded transition-colors text-sm font-medium"
               >
                  <Folder className="w-4 h-4 text-yellow-500" />
                  Folders
               </button>
               <button
                  onClick={openSettings}
                  className="flex items-center gap-2 hover:bg-[#4A4A4A] px-3 py-1.5 rounded transition-colors text-sm font-medium relative"
               >
                  <Settings className="w-4 h-4 text-neutral-300" />
                  Settings
                  {updateInfo?.has_update && (
                     <span className="absolute -top-1 -right-1 flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                     </span>
                  )}
               </button>
               <HelpButton
                  topic="dashboard"
                  label="Help"
                  className="text-white hover:bg-[#4A4A4A] px-3 py-1.5 rounded text-sm font-medium"
                  iconClassName="text-neutral-300"
               />
               <div className="ml-auto flex items-center gap-4">
                  <div className="flex flex-col items-end">
                     <span className="text-[9px] font-black text-neutral-500 uppercase tracking-tighter leading-none mb-0.5">Version</span>
                     <span className="text-[11px] font-mono font-bold text-neutral-400 leading-none">{updateInfo?.current_version || "..."}</span>
                  </div>
                  <button
                     onClick={fetchInstances}
                     className="flex items-center gap-2 hover:bg-[#4A4A4A] px-3 py-1.5 rounded transition-colors text-sm font-medium"
                  >
                     <RefreshCw className="w-4 h-4 text-sky-400" />
                     Refresh
                  </button>
               </div>
            </header>

            <main className="flex-1 overflow-auto p-6 bg-[#2B2B2B]">
               {loading ? (
                  <div className="text-neutral-400 flex items-center gap-2">
                     <RefreshCw className="w-5 h-5 animate-spin" /> Loading Instances...
                  </div>
               ) : instances.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-neutral-500">
                     <AlertCircle className="w-12 h-12 mb-4 opacity-50" />
                     <p>No instances found. Create folders in your servers directory.</p>
                  </div>
               ) : (
                  <div className="space-y-8">
                     {/* 1. Render Ungrouped servers directly (no folder container) */}
                     {(() => {
                        const ungroupedInstances = instances.filter(inst => !inst.group || inst.group === "No group");
                        if (ungroupedInstances.length === 0) return null;
                        return (
                           <div>
                              <div className="flex items-center gap-2 border-b border-[#404040]/30 pb-2 mb-4 cursor-default">
                                 <Layers className="w-4 h-4 text-neutral-400" />
                                 <span className="font-semibold text-neutral-300">Servers</span>
                                 <span className="text-[10px] text-neutral-500 font-mono bg-[#1A1A1A] px-2 py-0.5 rounded-full border border-[#2A2A2A]">
                                    {ungroupedInstances.length}
                                 </span>
                              </div>
                              <div className="flex flex-wrap gap-4">
                                 {ungroupedInstances.map((inst) => {
                                    const isSelected = selectedId === inst.id;
                                    const isRunning = statuses[inst.id]?.is_running;
                                    return (
                                       <div
                                          key={inst.id}
                                          onClick={() => setSelectedId(inst.id)}
                                          onContextMenu={(e) => handleContextMenu(e, inst.id)}
                                          className={`flex flex-col items-center justify-center p-3 rounded cursor-pointer transition-all w-[110px] select-none ${isSelected
                                                ? 'bg-[#3E8ED0]/20 outline outline-2 outline-[#3E8ED0] shadow-sm'
                                                : 'hover:bg-[#404040] border border-transparent'
                                             }`}
                                       >
                                          <div className="relative mb-3 flex items-center justify-center w-[72px] h-[72px] bg-[#3B3B3B] rounded shadow-inner">
                                             {inst.icon_url ? (
                                                <img
                                                   src={`${inst.icon_url}?v=${iconCacheBuster}`}
                                                   alt={inst.name}
                                                   className="w-16 h-16 object-contain rounded"
                                                />
                                             ) : (
                                                <Gamepad2 className={`w-10 h-10 ${isRunning ? (statuses[inst.id]?.is_ready ? 'text-emerald-400' : 'text-amber-400') : 'text-[#878787]'}`} />
                                             )}
                                             <div className={`absolute bottom-1 right-1 w-3 h-3 rounded-full border-2 border-[#3B3B3B] ${isRunning
                                                   ? (statuses[inst.id]?.is_ready ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse')
                                                   : 'bg-neutral-500'
                                                }`}></div>
                                          </div>
                                          <span className="text-xs text-center font-medium line-clamp-2 leading-tight break-all">
                                             {inst.name}
                                          </span>
                                       </div>
                                    );
                                 })}
                              </div>
                           </div>
                        );
                     })()}

                     {/* 2. Render Custom Folder Groups */}
                     {groups.filter(g => g !== "No group" && g !== "").map((groupName) => {
                        const groupInstances = instances.filter(inst => inst.group === groupName);
                        if (groupInstances.length === 0) return null;

                        return (
                           <div key={groupName} className="bg-[#2D2D2D]/30 p-4 rounded-lg border border-[#3A3A3A]/40 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
                              <div className="flex items-center justify-between border-b border-[#404040]/50 pb-2 mb-4 group/header cursor-default">
                                 <div className="flex items-center gap-2">
                                    <Folder className="w-4 h-4 text-yellow-500" />
                                    <span className="font-bold text-neutral-200 tracking-wide">
                                       {groupName}
                                    </span>
                                    <span className="text-[10px] text-neutral-500 font-mono bg-[#1A1A1A] px-2 py-0.5 rounded-full border border-[#2A2A2A]">
                                       {groupInstances.length} {groupInstances.length === 1 ? "server" : "servers"}
                                    </span>
                                 </div>

                                 <div className="flex items-center gap-2 opacity-0 group-hover/header:opacity-100 transition-opacity duration-200">
                                    <button
                                       onClick={(e) => { e.stopPropagation(); handleRenameGroup(groupName); }}
                                       className="p-1 hover:bg-[#3E8ED0]/20 rounded text-neutral-400 hover:text-sky-400 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                                       title="Rename Folder"
                                    >
                                       <Edit className="w-3.5 h-3.5" /> Rename
                                    </button>
                                    <button
                                       onClick={(e) => { e.stopPropagation(); handleDeleteGroup(groupName); }}
                                       className="p-1 hover:bg-red-500/20 rounded text-neutral-400 hover:text-red-400 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                                       title="Dissolve Folder"
                                    >
                                       <Trash2 className="w-3.5 h-3.5" /> Dissolve
                                    </button>
                                 </div>
                              </div>

                              <div className="flex flex-wrap gap-4">
                                 {groupInstances.map((inst) => {
                                    const isSelected = selectedId === inst.id;
                                    const isRunning = statuses[inst.id]?.is_running;

                                    return (
                                       <div
                                          key={inst.id}
                                          onClick={() => setSelectedId(inst.id)}
                                          onContextMenu={(e) => handleContextMenu(e, inst.id)}
                                          className={`flex flex-col items-center justify-center p-3 rounded cursor-pointer transition-all w-[110px] select-none ${isSelected
                                                ? 'bg-[#3E8ED0]/20 outline outline-2 outline-[#3E8ED0] shadow-sm'
                                                : 'hover:bg-[#404040] border border-transparent'
                                             }`}
                                       >
                                          <div className="relative mb-3 flex items-center justify-center w-[72px] h-[72px] bg-[#3B3B3B] rounded shadow-inner">
                                             {inst.icon_url ? (
                                                <img
                                                   src={`${inst.icon_url}?v=${iconCacheBuster}`}
                                                   alt={inst.name}
                                                   className="w-16 h-16 object-contain rounded"
                                                />
                                             ) : (
                                                <Gamepad2 className={`w-10 h-10 ${isRunning ? (statuses[inst.id]?.is_ready ? 'text-emerald-400' : 'text-amber-400') : 'text-[#878787]'}`} />
                                             )}
                                             <div className={`absolute bottom-1 right-1 w-3 h-3 rounded-full border-2 border-[#3B3B3B] ${isRunning
                                                   ? (statuses[inst.id]?.is_ready ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse')
                                                   : 'bg-neutral-500'
                                                }`}></div>
                                          </div>
                                          <span className="text-xs text-center font-medium line-clamp-2 leading-tight break-all">
                                             {inst.name}
                                          </span>
                                       </div>
                                    );
                                 })}
                              </div>
                           </div>
                        );
                     })}
                  </div>
               )}
            </main>
         </div>

         <aside className="w-[280px] min-w-[280px] flex-shrink-0 bg-[#242424] border-l border-[#1E1E1E] flex flex-col shadow-[rgba(0,0,0,0.1)_-4px_0px_15px_-3px] z-20 relative animate-in slide-in-from-right duration-300">
            {selectedInstance ? (
               <>
                  <div className="p-6 flex flex-col items-center border-b border-[#323232] relative group">
                     <button
                        onClick={() => setSelectedId(null)}
                        className="absolute top-4 right-4 p-1 rounded-full bg-[#1E1E1E] border border-[#333] text-neutral-500 hover:text-white hover:bg-[#333] transition opacity-0 group-hover:opacity-100 shadow-lg"
                     >
                        <X className="w-3.5 h-3.5" />
                     </button>
                     <div
                        onClick={() => {
                           setPendingIconId(selectedInstance.id);
                           iconInputRef.current?.click();
                        }}
                        className="w-24 h-24 bg-[#3B3B3B] rounded-lg shadow-inner flex flex-col items-center justify-center mb-4 relative cursor-pointer group/icon overflow-hidden border border-neutral-700 hover:border-sky-500 transition-all duration-300"
                        title="Click to change icon"
                     >
                        {selectedInstance.icon_url ? (
                           <img
                              src={`${selectedInstance.icon_url}?v=${iconCacheBuster}`}
                              alt={selectedInstance.name}
                              className="w-16 h-16 object-contain rounded transition-transform duration-300 group-hover/icon:scale-105"
                           />
                        ) : (
                           <Gamepad2 className="w-12 h-12 text-[#878787] transition-transform duration-300 group-hover/icon:scale-105" />
                        )}

                        {/* Premium hover overlay */}
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/icon:opacity-100 flex items-center justify-center transition-opacity duration-300">
                           <Pencil className="w-6 h-6 text-white drop-shadow-md animate-in zoom-in-50 duration-200" />
                        </div>

                        {selectedStatus?.is_running && (
                           <span className="absolute top-2 right-2 flex h-3 w-3 z-10">
                              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${selectedStatus?.is_ready ? 'bg-emerald-400' : 'bg-amber-400'} opacity-75`}></span>
                              <span className={`relative inline-flex rounded-full h-3 w-3 ${selectedStatus?.is_ready ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                           </span>
                        )}
                     </div>
                     <h2 className="text-lg font-bold text-center leading-tight mb-1 break-all">{selectedInstance.name}</h2>
                     <p className="text-xs text-neutral-400 text-center">
                        {!selectedStatus?.is_running
                           ? (selectedStatus?.startup_status === "Stopping..." ? 'Stopping...' : 'Offline')
                           : (selectedStatus?.is_ready ? 'Online' : (selectedStatus?.startup_status || 'Starting...'))}
                     </p>

                     {/* Progress Bar */}
                     {selectedStatus && (
                        (() => {
                           const showProgress = (selectedStatus.is_running && !selectedStatus.is_ready) ||
                              (selectedStatus.startup_status === "Stopping..." || selectedStatus.startup_status === "Restarting...");
                           const pct = selectedStatus.startup_percent || (selectedStatus.startup_status === "Stopping..." ? 50 : 0);
                           const isStopping = selectedStatus.startup_status === "Stopping..." || selectedStatus.startup_status === "Killing...";

                           if (!showProgress) return null;

                           return (
                              <div className="w-full mt-3 px-4">
                                 <div className="w-full bg-[#1A1A1A] border border-[#323232] p-2 rounded flex flex-col gap-1.5 shadow-inner">
                                    <div className="flex justify-between text-[10px] text-neutral-400 font-mono">
                                       <span className="truncate max-w-[150px]">{selectedStatus.startup_status || "Starting..."}</span>
                                       <span>{pct}%</span>
                                    </div>
                                    <div className="w-full bg-[#323232] rounded-full h-1.5 overflow-hidden">
                                       <div
                                          className={`h-1.5 rounded-full transition-all duration-500 ease-out animate-pulse ${isStopping ? 'bg-amber-600' : 'bg-[#3E8ED0]'}`}
                                          style={{ width: `${pct}%` }}
                                       ></div>
                                    </div>
                                 </div>
                              </div>
                           );
                        })()
                     )}
                  </div>

                  <div className="p-4 flex flex-col gap-1.5 flex-1 overflow-auto">
                     {selectedStatus?.is_running ? (
                        <div className="flex gap-1.5">
                           <button
                              onClick={(e: React.MouseEvent) => handleStop(selectedInstance.id, e)}
                              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-500 transition-all font-bold text-sm"
                              title="Safe Stop (Sends /stop, saves world progress)"
                           >
                              <Square className="w-3.5 h-3.5 fill-current" />
                              Stop
                           </button>
                           <button
                              onClick={(e: React.MouseEvent) => handleKill(selectedInstance.id, e)}
                              className="flex items-center justify-center px-4 py-2.5 rounded bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 transition-all font-bold text-sm"
                              title="Force Kill (Immediate power-off, UNSAFE)"
                           >
                              <X className="w-4 h-4" />
                              Kill
                           </button>
                        </div>
                     ) : (
                        <button
                           onClick={(e: React.MouseEvent) => handleStart(selectedInstance.id, e)}
                           className="flex items-center gap-3 px-3 py-2.5 rounded bg-[#1A3A22] hover:bg-[#204A2A] border border-[#2A5030] text-emerald-400 transition-colors"
                        >
                           <Play className="w-4 h-4 fill-current" />
                           <span className="font-semibold">Launch</span>
                        </button>
                     )}

                     <div className="h-px bg-[#323232] my-2"></div>

                     <button
                        onClick={openEditModal}
                        className="flex items-center gap-3 px-3 py-1.5 rounded hover:bg-[#323232] text-neutral-300 transition-colors"
                     >
                        <Edit className="w-4 h-4" /> Edit
                     </button>
                     <button
                        onClick={() => {
                           setIsGlobalBrowser(false);
                           setIsEditModalOpen(true);
                           setEditTab("files");
                           fetchFileList(selectedInstance.id);
                        }}
                        className="flex items-center gap-3 px-3 py-1.5 rounded hover:bg-[#323232] text-neutral-300 transition-colors"
                     >
                        <Folder className="w-4 h-4" /> Folder
                     </button>
                     <button
                        onClick={() => handleExport(selectedInstance.id)}
                        className="flex items-center gap-3 px-3 py-1.5 rounded hover:bg-[#323232] text-neutral-300 transition-colors"
                     >
                        <Share className="w-4 h-4 text-sky-400" /> Export
                     </button>
                     <div className="h-px bg-[#323232] my-2"></div>
                     <button
                        onClick={() => handleDelete(selectedInstance.id)}
                        className="flex items-center gap-3 px-3 py-1.5 rounded hover:bg-[#3D2525] text-red-400/80 transition-colors"
                     >
                        <Trash2 className="w-4 h-4" /> Delete
                     </button>
                  </div>

                  <div className="mt-auto p-4 bg-[#2D2D2D] border-t border-[#3A3A3A] space-y-3">
                     {selectedStatus?.public_ip && (
                        <div
                           onClick={() => copyToClipboard(`${selectedStatus.public_ip}:${selectedStatus.port || 25565}`, 'sidebar')}
                           className="flex items-center justify-between text-[11px] cursor-pointer hover:bg-[#323232] p-1.5 -mx-1.5 rounded-md transition group"
                           title="Click to copy server address"
                        >
                           <span className="flex items-center gap-1 text-neutral-500 uppercase font-bold tracking-wider">
                              Address
                              <HelpButton topic="networking" className="text-neutral-600" iconClassName="w-3 h-3" />
                           </span>
                           <div className="flex items-center gap-1.5">
                              <span className={`font-mono font-bold transition-colors ${copiedId === 'sidebar' ? 'text-emerald-400' : 'text-emerald-500 group-hover:underline'}`}>
                                 {copiedId === 'sidebar' ? 'COPIED!' : `${selectedStatus.public_ip}:${selectedStatus.port || 25565}`}
                              </span>
                              <Copy className={`w-2.5 h-2.5 transition-colors ${copiedId === 'sidebar' ? 'text-emerald-400' : 'text-neutral-600 group-hover:text-emerald-400'} mt-[-2px]`} />
                           </div>
                        </div>
                     )}
                     <div className="flex items-center justify-between text-[11px]">
                        <span className="text-neutral-500 uppercase font-bold tracking-wider">Version</span>
                        <span className="text-[#3E8ED0] font-mono font-bold bg-[#3E8ED0]/10 px-2 py-0.5 rounded border border-[#3E8ED0]/20">
                           {selectedStatus?.version || "Unknown"}
                        </span>
                     </div>
                     {isOutdatedRelease(selectedStatus?.version) && latestRelease && (
                        <button
                           onClick={openVersionUpdate}
                           className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-[11px] font-bold rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                           title={`Update this world to Minecraft ${latestRelease.id}`}
                        >
                           <RefreshCw className="w-3 h-3" /> Update to {latestRelease.id}
                        </button>
                     )}
                     <div className="flex items-center justify-between text-[11px]">
                        <span className="text-neutral-500 uppercase font-bold tracking-wider">Last Activity</span>
                        <span className="text-neutral-400">
                           {selectedStatus?.last_online ? (
                              new Date(selectedStatus.last_online * 1000).toLocaleString([], {
                                 month: 'short',
                                 day: 'numeric',
                                 hour: '2-digit',
                                 minute: '2-digit'
                              })
                           ) : "None"}
                        </span>
                     </div>
                  </div>
               </>
            ) : (
               <div className="flex flex-col items-center justify-center p-8 h-full text-center text-neutral-500">
                  <Layers className="w-12 h-12 mb-4 opacity-30" />
                  <p className="text-sm">Select an instance to view actions and details.</p>
               </div>
            )}
         </aside>

         {isAddModalOpen && (
            <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md p-6">
               <div className="bg-[#242424] border border-[#3A3A3A] rounded-lg shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">

                  {/* Top Bar: Name, Icon, Group, Port */}
                  <div className="px-6 py-5 border-b border-[#323232] bg-[#2B2B2B] flex items-center gap-6">
                     <div
                        onClick={() => newIconInputRef.current?.click()}
                        title="Click to choose an icon"
                        className="w-16 h-16 bg-[#3B3B3B] rounded flex items-center justify-center shadow-inner relative group border border-[#444] cursor-pointer"
                     >
                        {(newIconPreview || selectedModpack?.icon_url) ? <img src={newIconPreview || selectedModpack.icon_url} className="w-full h-full object-cover rounded" /> : <Gamepad2 className="w-8 h-8 text-neutral-600" />}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer rounded">
                           <Edit className="w-4 h-4 text-white" />
                        </div>
                     </div>
                     <div className="flex-1 space-y-3">
                        <div className="flex items-center gap-4">
                           <div className="flex-1">
                              <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-1">Instance Name</label>
                              <input
                                 autoFocus
                                 required
                                 type="text"
                                 value={newName}
                                 onChange={(e) => setNewName(e.target.value)}
                                 className="w-full bg-[#1A1A1A] border border-[#3A3A3A] px-3 py-1.5 rounded text-lg font-bold text-white focus:outline-none focus:border-[#3E8ED0]"
                                 placeholder="e.g. My Modded World"
                              />
                           </div>
                           <div className="w-32">
                              <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-1">Server Port</label>
                              <input
                                 required
                                 type="number"
                                 value={newPort}
                                 onChange={(e) => setNewPort(e.target.value)}
                                 className="w-full bg-[#1A1A1A] border border-[#3A3A3A] px-3 py-1.5 rounded text-lg font-mono text-emerald-400 focus:outline-none focus:border-[#3E8ED0]"
                                 placeholder="25565"
                              />
                           </div>
                        </div>
                        <div>
                           <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-1">Group</label>
                           <select className="w-full bg-[#1A1A1A] border border-[#3A3A3A] px-3 py-1 text-xs text-neutral-400 rounded focus:outline-none focus:border-[#3E8ED0]">
                              <option>No group</option>
                           </select>
                        </div>
                     </div>
                  </div>

                  <div className="flex-1 flex overflow-hidden">
                     {/* Sidebar - Only show in Step 1 */}
                     {addStep === 1 && (
                        <div className="w-48 bg-[#1E1E1E] border-r border-[#323232] p-2 flex flex-col gap-1">
                           <div className="px-3 py-2 text-[10px] font-bold text-neutral-600 uppercase tracking-widest mb-1">Server Type</div>
                           {[
                              { id: "custom", name: "Custom", icon: Gamepad2 },
                              { id: "import", name: "Import", icon: Database },
                              { id: "modrinth", name: "Modrinth", icon: RefreshCw }
                           ].map((tab) => (
                              <button
                                 key={tab.id}
                                 onClick={() => {
                                    setAddTab(tab.id as any);
                                    if (tab.id === 'modrinth') {
                                       handleModpackSearch("", tab.id);
                                    }
                                 }}
                                 className={`flex items-center gap-3 px-3 py-2 rounded text-sm font-medium transition-all ${addTab === tab.id ? 'bg-[#3E8ED0] text-white shadow-lg' : 'text-neutral-400 hover:bg-[#323232] hover:text-neutral-200'}`}
                              >
                                 <tab.icon className="w-4 h-4" />
                                 {tab.name}
                              </button>
                           ))}
                        </div>
                     )}

                     {/* Step Indicator Sidebar for Step 2 */}
                     {addStep === 2 && (
                        <div className="w-48 bg-[#1E1E1E] border-r border-[#323232] p-2 flex flex-col gap-1">
                           <div className="px-3 py-2 text-[10px] font-bold text-neutral-600 uppercase tracking-widest mb-1">Configuration</div>
                           <div className="flex items-center gap-3 px-3 py-2 rounded text-sm font-medium text-neutral-500 opacity-60">
                              <Check className="w-4 h-4 text-emerald-500" />
                              Server Type
                           </div>
                           <div className="flex items-center gap-3 px-3 py-2 rounded text-sm font-medium bg-[#3E8ED0] text-white shadow-lg">
                              <Globe className="w-4 h-4" />
                              World Settings
                           </div>
                        </div>
                     )}

                     {/* Content Area */}
                     <div className="flex-1 bg-[#1A1A1A] flex flex-col overflow-hidden">
                        {addStep === 1 ? (
                           <>
                              {addTab === "custom" && (
                                 <div className="flex flex-col h-full overflow-hidden">
                                    {/* Top Half: Minecraft Version Selection */}
                                    <div className="flex-1 flex flex-col p-4 overflow-hidden border-b border-[#323232]">
                                       <div className="flex items-center justify-between mb-3">
                                          <h4 className="text-sm font-bold text-neutral-300 flex items-center gap-2">
                                             <Layers className="w-4 h-4 text-[#3E8ED0]" />
                                             Minecraft Version
                                          </h4>
                                          <div className="flex items-center gap-4">
                                             <div className="flex items-center gap-4 mr-2">
                                                {(['Releases', 'Snapshots', 'Betas', 'Alphas'] as const).map(f => (
                                                   <label key={f} className="flex items-center gap-2 text-xs text-neutral-400 hover:text-white cursor-pointer">
                                                      <input
                                                         type="checkbox"
                                                         checked={versionFilters[f]}
                                                         onChange={(e) => setVersionFilters(prev => ({ ...prev, [f]: e.target.checked }))}
                                                         className="rounded bg-[#141414] border-[#333] accent-[#3E8ED0]"
                                                      />
                                                      {f}
                                                   </label>
                                                ))}
                                             </div>
                                             <div className="relative w-48">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-600" />
                                                <input
                                                   type="text"
                                                   placeholder="Search..."
                                                   className="w-full bg-[#141414] border border-[#333] pl-9 pr-4 py-1.5 rounded text-xs focus:outline-none focus:border-[#3E8ED0]"
                                                   value={versionSearch}
                                                   onChange={(e) => setVersionSearch(e.target.value)}
                                                />
                                             </div>
                                             <button onClick={fetchMcVersions} className="p-1.5 bg-[#323232] hover:bg-[#404040] rounded text-neutral-400 transition-colors">
                                                <RefreshCw className={`w-3.5 h-3.5 ${isVersionsLoading ? 'animate-spin' : ''}`} />
                                             </button>
                                          </div>
                                       </div>

                                       <div className="flex-1 border border-[#333] bg-[#0F0F0F] rounded overflow-hidden flex flex-col shadow-inner">
                                          <div className="grid grid-cols-3 px-4 py-2 border-b border-[#333] bg-[#242424] text-[10px] font-bold text-neutral-500 uppercase tracking-widest">
                                             <div>Version</div>
                                             <div className="text-right">Released</div>
                                             <div className="text-right">Type</div>
                                          </div>
                                          <div className="flex-1 overflow-auto relative">
                                             {isVersionsLoading ? (
                                                <div className="absolute inset-0 flex items-center justify-center bg-[#0F0F0F]/50">
                                                   <div className="flex flex-col items-center gap-3">
                                                      <RefreshCw className="w-8 h-8 text-[#3E8ED0] animate-spin" />
                                                      <span className="text-xs font-medium text-neutral-500 tracking-wide">Fetching versions...</span>
                                                   </div>
                                                </div>
                                             ) : mcVersions.filter(v => {
                                                if (versionSearch && !v.id.includes(versionSearch)) return false;
                                                if (v.type === 'release' && versionFilters.Releases) return true;
                                                if (v.type === 'snapshot' && versionFilters.Snapshots) return true;
                                                if (v.type === 'old_beta' && versionFilters.Betas) return true;
                                                if (v.type === 'old_alpha' && versionFilters.Alphas) return true;
                                                return false;
                                             }).length === 0 ? (
                                                <div className="flex flex-col items-center justify-center h-full gap-2 text-neutral-600 opacity-50">
                                                   <Search className="w-6 h-6" />
                                                   <p className="text-xs">No versions match your filters</p>
                                                </div>
                                             ) : (
                                                mcVersions
                                                   .filter(v => {
                                                      if (versionSearch && !v.id.includes(versionSearch)) return false;
                                                      if (v.type === 'release' && versionFilters.Releases) return true;
                                                      if (v.type === 'snapshot' && versionFilters.Snapshots) return true;
                                                      if (v.type === 'old_beta' && versionFilters.Betas) return true;
                                                      if (v.type === 'old_alpha' && versionFilters.Alphas) return true;
                                                      return false;
                                                   })
                                                   .map((v: any) => (
                                                      <div
                                                         key={v.id}
                                                         onClick={() => setSelectedAddVersion(v.id)}
                                                         className={`grid grid-cols-3 px-4 py-2 text-sm font-mono cursor-pointer border-b border-[#1A1A1A] last:border-0 transition-all ${selectedAddVersion === v.id ? 'bg-[#3E8ED0]/20 text-[#3E8ED0] border-l-2 border-l-[#3E8ED0]' : 'text-neutral-400 hover:bg-[#222]'}`}
                                                      >
                                                         <div className="flex items-center gap-2">
                                                            {v.type === 'release' && <Check className={`w-3 h-3 ${selectedAddVersion === v.id ? 'text-[#3E8ED0]' : 'text-emerald-500'}`} />}
                                                            <span>{v.id}</span>
                                                         </div>
                                                         <div className="text-right opacity-50">{new Date(v.releaseTime).toLocaleDateString()}</div>
                                                         <div className="text-right capitalize text-[10px] font-bold opacity-60">{v.type}</div>
                                                      </div>
                                                   ))
                                             )}
                                          </div>
                                       </div>
                                    </div>

                                    {/* Bottom Half: Mod Loader selection */}
                                    <div className="flex-1 flex flex-col p-4 bg-[#141414] overflow-hidden">
                                       <div className="flex items-center justify-between mb-3">
                                          <h4 className="text-sm font-bold text-neutral-300 flex items-center gap-2">
                                             <Cpu className="w-4 h-4 text-[#3E8ED0]" />
                                             Mod Loader
                                          </h4>
                                          <div className="flex bg-[#1E1E1E] rounded p-1 border border-[#323232] overflow-x-auto max-w-full">
                                             {['VANILLA', 'FABRIC', 'FORGE', 'NEOFORGE', 'QUILT', 'PAPER'].map(l => (
                                                <button
                                                   key={l}
                                                   onClick={() => setSelectedAddLoader(l)}
                                                   className={`px-3 py-1 rounded text-[10px] font-bold transition-all flex-shrink-0 ${(selectedAddLoader || '').toUpperCase() === l ? 'bg-[#3E8ED0] text-white shadow-md' : 'text-neutral-500 hover:text-white'}`}
                                                >
                                                   {l}
                                                </button>
                                             ))}
                                          </div>
                                       </div>

                                       <div className="flex-1 border border-[#333] bg-[#0F0F0F] rounded overflow-hidden flex flex-col shadow-inner">
                                          {selectedAddLoader === 'VANILLA' ? (
                                             <div className="flex flex-col items-center justify-center h-full text-neutral-500 italic text-xs gap-3 p-8 text-center bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')] opacity-20">
                                                <div className="w-12 h-12 rounded-full border border-neutral-700 flex items-center justify-center">
                                                   <Box className="w-6 h-6" />
                                                </div>
                                                Vanilla does not require a mod loader.
                                             </div>
                                          ) : (
                                             <>
                                                <div className="grid grid-cols-2 px-4 py-2 border-b border-[#333] bg-[#242424] text-[10px] font-bold text-neutral-500 uppercase tracking-widest">
                                                   <div>Loader Version</div>
                                                   <div className="text-right">Status</div>
                                                </div>
                                                <div className="flex-1 overflow-auto relative">
                                                   {isLoaderLoading ? (
                                                      <div className="absolute inset-0 flex items-center justify-center bg-[#0F0F0F]/50">
                                                         <div className="flex flex-col items-center gap-3">
                                                            <RefreshCw className="w-6 h-6 text-[#3E8ED0] animate-spin" />
                                                            <span className="text-[10px] text-neutral-500">Scanning versions...</span>
                                                         </div>
                                                      </div>
                                                   ) : (
                                                      <div className="divide-y divide-[#1A1A1A]">
                                                         <div
                                                            onClick={() => setSelectedAddLoaderVersion("latest")}
                                                            className={`grid grid-cols-2 px-4 py-2 text-sm cursor-pointer transition-all ${selectedAddLoaderVersion === 'latest' ? 'bg-[#3E8ED0]/20 text-[#3E8ED0] border-l-2 border-l-[#3E8ED0]' : 'text-neutral-400 hover:bg-[#222]'}`}
                                                         >
                                                            <div className="font-bold italic">Latest Recommended</div>
                                                            <div className="text-right text-[10px] opacity-60">AUTO</div>
                                                         </div>
                                                         {loaderVersions.map((lv) => (
                                                            <div
                                                               key={lv.id}
                                                               onClick={() => setSelectedAddLoaderVersion(lv.id)}
                                                               className={`grid grid-cols-2 px-4 py-2 text-sm font-mono cursor-pointer transition-all ${selectedAddLoaderVersion === lv.id ? 'bg-[#3E8ED0]/20 text-[#3E8ED0] border-l-2 border-l-[#3E8ED0]' : 'text-neutral-400 hover:bg-[#222]'}`}
                                                            >
                                                               <div>{lv.id}</div>
                                                               <div className="text-right">
                                                                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${lv.stable ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'}`}>
                                                                     {lv.stable ? 'STABLE' : 'UNSTABLE'}
                                                                  </span>
                                                               </div>
                                                            </div>
                                                         ))}
                                                      </div>
                                                   )}
                                                </div>
                                             </>
                                          )}
                                       </div>
                                    </div>
                                 </div>
                              )}

                              {addTab === "import" && (
                                 <div className="flex flex-col items-center justify-center h-full text-neutral-500 p-20 text-center space-y-6">
                                    <div className="w-20 h-20 bg-[#3E8ED0]/10 rounded-full flex items-center justify-center border border-[#3E8ED0]/20">
                                       <Database className="w-10 h-10 text-[#3E8ED0]" />
                                    </div>
                                    <div className="space-y-2">
                                       <h3 className="text-xl font-bold text-white">
                                          {importFile ? "File Selected" : "Import Server / World"}
                                       </h3>
                                       <p className="text-sm text-neutral-400 max-w-sm">
                                          {importFile ? (
                                             <span className="font-mono text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20 block truncate max-w-xs mx-auto">
                                                {importFile.name}
                                             </span>
                                          ) : (
                                             "Upload an Isopod server export (.zip) or a Minecraft singleplayer world (.zip containing level.dat) to create a new server instance."
                                          )}
                                       </p>
                                    </div>
                                    <div className="flex gap-2">
                                       <label className="px-6 py-2.5 bg-[#3E8ED0] hover:bg-[#2B6A9E] rounded-lg font-bold text-white transition-all cursor-pointer shadow-lg shadow-[#3E8ED0]/15 text-sm">
                                          {importFile ? "Change Zip File" : "Browse Zip File"}
                                          <input type="file" className="hidden" accept=".zip" onChange={handleImport} />
                                       </label>
                                       {importFile && (
                                          <button
                                             onClick={() => {
                                                setImportFile(null);
                                                setNewName("");
                                             }}
                                             className="px-6 py-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 rounded-lg font-bold transition-all text-sm"
                                          >
                                             Clear
                                          </button>
                                       )}
                                    </div>
                                 </div>
                              )}

                              {addTab === "modrinth" && (
                                 <div className="flex flex-col h-full bg-[#1E1E1E]/50">
                                    <div className="p-4 bg-[#242424] border-b border-[#323232] flex flex-col gap-3">
                                       <div className="flex gap-3 w-full">
                                          <div className="flex-1 relative">
                                             <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                                             <input
                                                type="text"
                                                placeholder={`Search ${addTab} modpacks...`}
                                                value={searchModpacks}
                                                onChange={(e) => setSearchModpacks(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && handleModpackSearch(searchModpacks, addTab)}
                                                className="w-full bg-[#141414] border border-[#3A3A3A] pl-10 pr-4 py-2 rounded focus:outline-none focus:border-[#3E8ED0] text-sm"
                                             />
                                          </div>
                                          <button
                                             onClick={() => handleModpackSearch(searchModpacks, addTab)}
                                             className="px-6 py-2 bg-[#3E8ED0] hover:bg-[#2B6A9E] text-white font-bold rounded text-sm transition-all shadow-lg shadow-[#3E8ED0]/15"
                                          >
                                             Search
                                          </button>
                                       </div>
                                       {addTab === "modrinth" && (
                                          <label className="flex items-center gap-2 cursor-pointer self-start">
                                             <input
                                                type="checkbox"
                                                checked={onlyServerSideModpacks}
                                                onChange={(e) => setOnlyServerSideModpacks(e.target.checked)}
                                                className="rounded border-[#3A3A3A] bg-[#141414] text-[#3E8ED0] focus:ring-[#3E8ED0]"
                                             />
                                             <span className="text-xs text-neutral-400 select-none">Show only server-side compatible modpacks</span>
                                          </label>
                                       )}
                                    </div>
                                    <div className="flex-1 overflow-auto p-4 grid grid-cols-1 gap-2">
                                       {isModpackLoading ? (
                                          <div className="flex flex-col items-center justify-center h-64 text-neutral-600 gap-3">
                                             <RefreshCw className="w-8 h-8 animate-spin" />
                                             <span className="text-sm font-medium">Fetching modpacks...</span>
                                          </div>
                                       ) : modpackResults.length === 0 ? (
                                          <div className="flex flex-col items-center justify-center h-64 text-neutral-600 opacity-40">
                                             <Box className="w-12 h-12 mb-3" />
                                             <p className="text-sm">Enter keywords to find modpacks</p>
                                          </div>
                                       ) : (
                                          modpackResults.map((pack) => (
                                             <div
                                                key={pack.id}
                                                onClick={() => {
                                                   setSelectedModpack(pack);
                                                   // Follow the selected pack's name unless the user has typed a custom one
                                                   if (!newName || newName === selectedModpack?.name) setNewName(pack.name);
                                                   fetchModpackVersions(pack.id, addTab);
                                                }}
                                                className={`flex items-center gap-4 p-3 rounded-lg border cursor-pointer transition-all ${selectedModpack?.id === pack.id ? 'bg-[#3E8ED0]/20 border-[#3E8ED0] shadow-lg shadow-[#3E8ED0]/5' : 'bg-[#222] border-[#333] hover:bg-[#282828] hover:border-[#444]'}`}
                                             >
                                                <div className="w-12 h-12 bg-[#333] rounded overflow-hidden flex-shrink-0 shadow-inner">
                                                   {pack.icon_url ? <img src={pack.icon_url} className="w-full h-full object-cover" /> : <Box className="w-full h-full p-2 text-neutral-600" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                   <div className="flex items-center justify-between mb-0.5">
                                                      <h5 className="font-bold text-[#E0E0E0] truncate text-sm">{pack.name || 'Unknown'}</h5>
                                                      <span className="text-[10px] font-mono text-neutral-500 bg-[#111] px-1.5 py-0.5 rounded italic">By {pack.author || 'Unknown'}</span>
                                                   </div>
                                                   <p className="text-[11px] text-neutral-400 line-clamp-1 leading-relaxed">{pack.summary || 'No description provided.'}</p>
                                                   <div className="flex items-center gap-4 mt-1">
                                                      <span className="text-[9px] font-bold text-neutral-500 uppercase flex items-center gap-1"><RefreshCw className="w-2.5 h-2.5" /> {(pack.downloads || 0).toLocaleString()} DL</span>
                                                   </div>
                                                   {selectedModpack?.id === pack.id && (
                                                      <div className="mt-3 pt-3 border-t border-[#3E8ED0]/20 flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
                                                         <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Select Version</label>
                                                         {isModpackVersionsLoading ? (
                                                            <div className="flex items-center gap-2 text-xs text-neutral-500">
                                                               <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                                               <span>Loading versions...</span>
                                                            </div>
                                                         ) : (
                                                            <div className="flex flex-col gap-1.5">
                                                               <select
                                                                  value={selectedModpackVersion}
                                                                  onChange={(e) => setSelectedModpackVersion(e.target.value)}
                                                                  className="w-full bg-[#141414] border border-[#3E8ED0]/40 rounded p-1.5 text-xs text-[#E0E0E0] focus:outline-none focus:border-[#3E8ED0] font-medium"
                                                               >
                                                                  {modpackVersions.map((v: any) => (
                                                                     <option key={v.id} value={v.id}>
                                                                        {v.name} ({v.game_versions?.join(', ') || 'unknown MC'})
                                                                     </option>
                                                                  ))}
                                                               </select>
                                                               {(() => {
                                                                  const activeVer = modpackVersions.find((v: any) => v.id === selectedModpackVersion);
                                                                  if (!activeVer) return null;
                                                                  return (
                                                                     <div className="flex flex-wrap gap-x-3 gap-y-1 mt-0.5 text-[10px] text-neutral-500">
                                                                        <span className="flex items-center gap-1">
                                                                           <span className="font-semibold text-neutral-400">Minecraft:</span> {activeVer.game_versions?.join(', ') || 'N/A'}
                                                                        </span>
                                                                        <span className="flex items-center gap-1">
                                                                           <span className="font-semibold text-neutral-400">Loader:</span> {activeVer.loaders?.join(', ') || 'N/A'}
                                                                        </span>
                                                                        <span className="flex items-center gap-1">
                                                                           <span className="font-semibold text-neutral-400">Type:</span>
                                                                           <span className={`px-1 rounded text-[9px] uppercase font-bold ${activeVer.version_type === 'release' ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
                                                                              {activeVer.version_type || 'N/A'}
                                                                           </span>
                                                                        </span>
                                                                     </div>
                                                                  );
                                                               })()}
                                                            </div>
                                                         )}
                                                      </div>
                                                   )}
                                                </div>
                                             </div>
                                          ))
                                       )}
                                    </div>
                                 </div>
                              )}
                           </>
                        ) : (
                           <div className="flex flex-col h-full p-8 overflow-auto animate-in fade-in slide-in-from-right-4 duration-300">
                              <div className="max-w-xl mx-auto w-full space-y-8">
                                 <div className="flex items-center gap-4 mb-2">
                                    <div className="p-3 bg-[#3E8ED0]/10 rounded-xl border border-[#3E8ED0]/20 text-[#3E8ED0]">
                                       <Globe className="w-8 h-8" />
                                    </div>
                                    <div>
                                       <h3 className="text-2xl font-bold text-white">World configuration</h3>
                                       <p className="text-neutral-500 text-sm">Fine-tune your world generation and gameplay rules.</p>
                                    </div>
                                 </div>

                                 <div className="space-y-6">
                                    <div className="space-y-3">
                                       <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest pl-1">World Seed</label>
                                       <input
                                          type="text"
                                          value={newSeed}
                                          onChange={(e) => setNewSeed(e.target.value)}
                                          placeholder="Leave empty for random seed..."
                                          className="w-full bg-[#0F0F0F] border border-[#333] p-4 rounded-xl focus:outline-none focus:border-[#3E8ED0] text-sm font-mono text-white transition-all hover:border-[#444]"
                                       />
                                       <p className="text-[10px] text-neutral-600 italic px-1">Supports text and numbers. Minecraft will hash text seeds.</p>
                                    </div>

                                    <div className="grid grid-cols-2 gap-8">
                                       <div className="space-y-3">
                                          <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest pl-1">Level Type</label>
                                          <select
                                             value={newLevelType}
                                             onChange={(e) => setNewLevelType(e.target.value)}
                                             className="w-full bg-[#0F0F0F] border border-[#333] p-4 rounded-xl focus:outline-none focus:border-[#3E8ED0] text-sm text-neutral-300 appearance-none transition-all hover:border-[#444]"
                                          >
                                             <option value="DEFAULT">Default</option>
                                             <option value="FLAT">Flat</option>
                                             <option value="LARGEBIOMES">Large Biomes</option>
                                             <option value="AMPLIFIED">Amplified</option>
                                             <option value="BUFFET">Buffet</option>
                                          </select>
                                       </div>
                                       <div className="space-y-3">
                                          <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest pl-1">Difficulty</label>
                                          <select
                                             value={newDifficulty}
                                             onChange={(e) => setNewDifficulty(e.target.value)}
                                             className="w-full bg-[#0F0F0F] border border-[#333] p-4 rounded-xl focus:outline-none focus:border-[#3E8ED0] text-sm text-neutral-300 appearance-none transition-all hover:border-[#444]"
                                          >
                                             <option value="peaceful">Peaceful</option>
                                             <option value="easy">Easy</option>
                                             <option value="normal">Normal</option>
                                             <option value="hard">Hard</option>
                                          </select>
                                       </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-8">
                                       <div className="space-y-3">
                                          <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest pl-1">Game Mode</label>
                                          <select
                                             value={newGamemode}
                                             onChange={(e) => setNewGamemode(e.target.value)}
                                             className="w-full bg-[#0F0F0F] border border-[#333] p-4 rounded-xl focus:outline-none focus:border-[#3E8ED0] text-sm text-neutral-300 appearance-none transition-all hover:border-[#444]"
                                          >
                                             <option value="survival">Survival</option>
                                             <option value="creative">Creative</option>
                                             <option value="adventure">Adventure</option>
                                             <option value="spectator">Spectator</option>
                                          </select>
                                       </div>
                                       <div className="space-y-3">
                                          <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest pl-1">Structures</label>
                                          <button
                                             onClick={() => setNewGenerateStructures(!newGenerateStructures)}
                                             className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all ${newGenerateStructures ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400' : 'bg-red-500/5 border-red-500/20 text-red-400'}`}
                                          >
                                             <span className="text-sm font-bold uppercase tracking-wider">{newGenerateStructures ? 'Enabled' : 'Disabled'}</span>
                                             {newGenerateStructures ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
                                          </button>
                                       </div>
                                    </div>
                                 </div>

                                 {/* Server Whitelist & Player Access */}
                                 <div className="bg-[#242424] border border-[#3A3A3A] p-6 rounded-2xl space-y-4 shadow-xl">
                                    <div className="flex items-center justify-between">
                                       <div className="flex items-center gap-3">
                                          <div className="p-2 bg-amber-500/10 rounded-lg text-amber-400">
                                             <Shield className="w-5 h-5" />
                                          </div>
                                          <div>
                                             <h4 className="font-bold text-white text-base">Server Whitelist</h4>
                                             <p className="text-xs text-neutral-400">Restrict access to specified Minecraft usernames.</p>
                                          </div>
                                       </div>
                                       <button
                                          type="button"
                                          onClick={() => setModalWhitelistEnabled(!modalWhitelistEnabled)}
                                          className={`w-12 h-6 rounded-full transition-all relative ${modalWhitelistEnabled ? 'bg-amber-500' : 'bg-[#333]'}`}
                                       >
                                          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${modalWhitelistEnabled ? 'left-7' : 'left-1'}`} />
                                       </button>
                                    </div>

                                    <div className="space-y-3 pt-2 border-t border-[#333]">
                                       <div className="flex items-center justify-between">
                                          <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest block">
                                             Allowed Players ({modalWhitelistUsers.length})
                                          </label>
                                          <span className="text-[10px] text-neutral-500 font-medium">
                                             {modalWhitelistEnabled ? "Whitelist active" : "Whitelist inactive (players saved to server roster)"}
                                          </span>
                                       </div>
                                          <div className="flex gap-2">
                                             <input
                                                type="text"
                                                value={modalWhitelistUserDraft}
                                                onChange={(e) => setModalWhitelistUserDraft(e.target.value)}
                                                onKeyDown={(e) => {
                                                   if (e.key === 'Enter') {
                                                      e.preventDefault();
                                                      const val = modalWhitelistUserDraft.trim();
                                                      if (val && !modalWhitelistUsers.includes(val)) {
                                                         setModalWhitelistUsers([...modalWhitelistUsers, val]);
                                                         setModalWhitelistUserDraft("");
                                                      }
                                                   }
                                                }}
                                                placeholder="Enter Minecraft username..."
                                                className="flex-1 bg-[#141414] border border-[#3A3A3A] px-3 py-2 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500/50"
                                             />
                                             <button
                                                type="button"
                                                onClick={() => {
                                                   const val = modalWhitelistUserDraft.trim();
                                                   if (val && !modalWhitelistUsers.includes(val)) {
                                                      setModalWhitelistUsers([...modalWhitelistUsers, val]);
                                                      setModalWhitelistUserDraft("");
                                                   }
                                                }}
                                                className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold text-xs rounded-lg border border-amber-500/30 transition-colors"
                                             >
                                                Add Player
                                             </button>
                                          </div>

                                          {modalWhitelistUsers.length > 0 ? (
                                             <div className="flex flex-wrap gap-2 pt-1">
                                                {modalWhitelistUsers.map((u) => (
                                                   <span
                                                      key={u}
                                                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#141414] border border-[#3A3A3A] text-xs font-mono text-neutral-200"
                                                   >
                                                      <img
                                                         src={getPlayerAvatarUrl(u, 24)}
                                                         alt=""
                                                         className="w-4 h-4 rounded-sm"
                                                         onError={(e) => {
                                                            e.currentTarget.src = `https://crafthead.net/avatar/${u}/24`;
                                                         }}
                                                      />
                                                      <span>{u}</span>
                                                      <button
                                                         type="button"
                                                         onClick={() => setModalWhitelistUsers(modalWhitelistUsers.filter(x => x !== u))}
                                                         className="text-neutral-500 hover:text-red-400 ml-0.5"
                                                      >
                                                         <X className="w-3 h-3" />
                                                      </button>
                                                   </span>
                                                ))}
                                             </div>
                                          ) : (
                                             <p className="text-xs text-neutral-500 italic">No players added yet. Anyone will be blocked until added to the whitelist.</p>
                                          )}
                                       </div>
                                 </div>

                                 <div className="bg-[#2D2D2D] border border-[#3A3A3A] p-6 rounded-2xl flex gap-5 items-start shadow-xl">
                                    <div className="p-2 bg-amber-500/10 rounded-lg text-amber-500">
                                       <AlertCircle className="w-6 h-6" />
                                    </div>
                                    <div className="space-y-2">
                                       <h4 className="font-bold text-neutral-200">World Management Info</h4>
                                       <p className="text-xs text-neutral-500 leading-relaxed">
                                          These settings apply to the world created when the server first starts.
                                          If you change them later, they may only affect newly generated chunks or require a world reset.
                                       </p>
                                    </div>
                                 </div>
                              </div>
                           </div>
                        )}

                     </div>
                  </div>

                  {/* Bottom Actions */}
                  <div className="p-4 bg-[#2D2D2D] border-t border-[#3A3A3A] flex justify-between items-center px-6">
                     <div className="flex items-center gap-4">
                        <HelpButton topic={`new-${addTab}`} label="Help" className="text-xs font-medium" />
                        {isCreating && addTab === 'import' && (
                           <div className="flex flex-col gap-1.5 w-64 md:w-80">
                              <div className="flex justify-between text-xs font-semibold text-neutral-300">
                                 <span className="animate-pulse text-amber-500">{importStatus || "Uploading & extracting..."}</span>
                                 {importProgress !== null && <span>{importProgress}%</span>}
                              </div>
                              <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden border border-[#3A3A3A]">
                                 <div
                                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-300 ease-out"
                                    style={{ width: `${importProgress !== null ? importProgress : 50}%` }}
                                 />
                              </div>
                           </div>
                        )}
                     </div>
                     <div className="flex gap-2">
                        {addStep === 2 && (
                           <button
                              onClick={() => setAddStep(1)}
                              className="px-6 py-2 rounded bg-transparent hover:bg-[#3A3A3A] text-neutral-400 hover:text-white font-bold transition-all text-sm border border-[#444]"
                           >
                              Back
                           </button>
                        )}
                        <button
                           onClick={() => setIsAddModalOpen(false)}
                           className="px-6 py-2 rounded bg-transparent hover:bg-[#3A3A3A] text-neutral-400 hover:text-white font-bold transition-all text-sm"
                        >
                           Cancel
                        </button>
                        {addStep === 1 ? (
                           <button
                              onClick={() => setAddStep(2)}
                              disabled={!newName || (addTab === 'import' && !importFile) || (addTab !== 'custom' && addTab !== 'import' && (!selectedModpack || !selectedModpackVersion))}
                              className={`flex items-center gap-2 px-8 py-2 rounded font-bold text-sm shadow-xl transition-all ${!newName || (addTab === 'import' && !importFile) || (addTab !== 'custom' && addTab !== 'import' && (!selectedModpack || !selectedModpackVersion)) ? 'bg-neutral-800 text-neutral-600 cursor-not-allowed border border-[#333]' : 'bg-[#3E8ED0] hover:bg-[#2B6A9E] text-white shadow-[#3E8ED0]/10'
                                 }`}
                           >
                              Next <ChevronRight className="w-4 h-4" />
                           </button>
                        ) : (
                           <button
                              onClick={handleAddInstance}
                              disabled={isCreating || !newName}
                              className={`px-8 py-2 rounded font-bold text-sm shadow-xl transition-all ${isCreating || !newName ? 'bg-neutral-800 text-neutral-600 cursor-not-allowed border border-[#333]' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/10'
                                 }`}
                           >
                              {isCreating ? "Creating..." : "Create Instance"}
                           </button>
                        )}
                     </div>
                  </div>

               </div>
            </div>
         )}

         {isEditModalOpen && (selectedInstance || isGlobalBrowser) && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-6">
               <div className="bg-[#242424] border border-[#3A3A3A] rounded-lg shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
                  {/* Header */}
                  <div className="px-6 py-4 border-b border-[#3A3A3A] flex justify-between items-center bg-[#2B2B2B]">
                     <div className="flex items-center gap-3">
                        <div className="p-1.5 bg-[#3E8ED0]/10 rounded border border-[#3E8ED0]/30">
                           <Edit className="w-5 h-5 text-[#3E8ED0]" />
                        </div>
                        <div className="flex flex-col gap-1">
                           <div className="flex items-center gap-3">
                              <h2 className="text-xl font-bold text-[#E0E0E0]">
                                 {isGlobalBrowser ? "Global Folders" : (selectedInstance ? `Editing: ${selectedInstance.name}` : "Editing")}
                              </h2>
                              {!isGlobalBrowser && selectedInstance && (
                                 <div className="flex items-center gap-2 bg-[#1A1A1A] border border-[#3A3A3A] px-2.5 py-0.5 rounded-full">
                                    <span className="relative flex h-2 w-2">
                                       {statuses[selectedInstance.id]?.is_running && (
                                          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${statuses[selectedInstance.id]?.is_ready ? 'bg-emerald-400' : 'bg-amber-400'} opacity-75`}></span>
                                       )}
                                       <span className={`relative inline-flex rounded-full h-2 w-2 ${statuses[selectedInstance.id]?.is_running ? (statuses[selectedInstance.id]?.is_ready ? 'bg-emerald-500' : 'bg-amber-500') : 'bg-neutral-500'}`}></span>
                                    </span>
                                    <span className="text-[11px] font-medium text-neutral-300">
                                       {!statuses[selectedInstance.id]?.is_running
                                          ? (statuses[selectedInstance.id]?.startup_status === "Stopping..." ? 'Stopping' : 'Offline')
                                          : (statuses[selectedInstance.id]?.is_ready ? 'Online' : (statuses[selectedInstance.id]?.startup_status || 'Starting...'))}
                                    </span>
                                 </div>
                              )}
                           </div>


                        </div>
                     </div>
                     <div className="flex items-center gap-2">
                        <HelpButton topic={editTab} className="p-1.5 hover:bg-[#3A3A3A] rounded-full text-neutral-400" iconClassName="w-5 h-5" />
                        <button onClick={closeEditModal} className="p-1 hover:bg-[#3A3A3A] rounded-full text-neutral-400 hover:text-white transition" title="Close without saving">
                           <X className="w-6 h-6" />
                        </button>
                     </div>
                  </div>

                  <div className="flex flex-1 overflow-hidden">
                     {/* Left Sidebar Tabs */}
                     <div className="w-56 bg-[#1E1E1E] border-r border-[#3A3A3A] p-4 flex flex-col justify-between">
                        <div className="flex flex-col gap-1.5">
                           <button
                              onClick={() => setEditTab("logs")}
                              className={`flex items-center gap-3 px-3 py-2.5 rounded text-left font-medium transition-all ${editTab === "logs" ? 'bg-[#3E8ED0] text-white shadow-lg' : 'text-neutral-400 hover:bg-[#323232] hover:text-neutral-200'}`}
                           >
                              <Terminal className="w-4 h-4" />
                              Minecraft Log
                           </button>
                           <button
                              onClick={() => setEditTab("version")}
                              className={`flex items-center gap-3 px-3 py-2.5 rounded text-left font-medium transition-all ${editTab === "version" ? 'bg-[#3E8ED0] text-white shadow-lg' : 'text-neutral-400 hover:bg-[#323232] hover:text-neutral-200'}`}
                           >
                              <Database className="w-4 h-4" />
                              Versions
                           </button>
                           <button
                              onClick={() => setEditTab("loader")}
                              className={`flex items-center gap-3 px-3 py-2.5 rounded text-left font-medium transition-all ${editTab === "loader" ? 'bg-[#3E8ED0] text-white shadow-lg' : 'text-neutral-400 hover:bg-[#323232] hover:text-neutral-200'}`}
                           >
                              <Cpu className="w-4 h-4" />
                              Loaders
                           </button>
                           <button
                              onClick={() => {
                                 setEditTab("files");
                                 fetchFileList(isGlobalBrowser ? null : (selectedInstance?.id || null));
                              }}
                              className={`flex items-center gap-3 px-3 py-2.5 rounded text-left font-medium transition-all ${editTab === "files" ? 'bg-[#3E8ED0] text-white shadow-lg' : 'text-neutral-400 hover:bg-[#323232] hover:text-neutral-200'}`}
                           >
                              <Folder className="w-4 h-4" />
                              Files
                           </button>
                           <button
                              onClick={() => setEditTab("world")}
                              className={`flex items-center gap-3 px-3 py-2.5 rounded text-left font-medium transition-all ${editTab === "world" ? 'bg-[#3E8ED0] text-white shadow-lg' : 'text-neutral-400 hover:bg-[#323232] hover:text-neutral-200'}`}
                           >
                              <Globe className="w-4 h-4" />
                              World
                           </button>
                           <button
                              onClick={() => setEditTab("backups")}
                              className={`flex items-center gap-3 px-3 py-2.5 rounded text-left font-medium transition-all ${editTab === "backups" ? 'bg-[#3E8ED0] text-white shadow-lg' : 'text-neutral-400 hover:bg-[#323232] hover:text-neutral-200'}`}
                           >
                              <Archive className="w-4 h-4" />
                              Backups
                           </button>
                           <button
                              onClick={() => setEditTab("mods")}
                              className={`flex items-center gap-3 px-3 py-2.5 rounded text-left font-medium transition-all ${editTab === "mods" ? 'bg-[#3E8ED0] text-white shadow-lg' : 'text-neutral-400 hover:bg-[#323232] hover:text-neutral-200'}`}
                           >
                              <Box className="w-4 h-4" />
                              Mods
                           </button>
                           <button
                              onClick={() => setEditTab("resource-pack")}
                              className={`flex items-center gap-3 px-3 py-2.5 rounded text-left font-medium transition-all ${editTab === "resource-pack" ? 'bg-[#3E8ED0] text-white shadow-lg' : 'text-neutral-400 hover:bg-[#323232] hover:text-neutral-200'}`}
                           >
                              <Layers className="w-4 h-4" />
                              Resource Packs
                           </button>
                           <button
                              onClick={() => setEditTab("config")}
                              className={`flex items-center gap-3 px-3 py-2.5 rounded text-left font-medium transition-all ${editTab === "config" ? 'bg-[#3E8ED0] text-white shadow-lg' : 'text-neutral-400 hover:bg-[#323232] hover:text-neutral-200'}`}
                           >
                              <Settings className="w-4 h-4" />
                              Configuration
                           </button>
                           <button
                              onClick={() => {
                                 setEditTab("users");
                                 fetchInstanceUsers(selectedInstance?.id || "");
                              }}
                              className={`flex items-center gap-3 px-3 py-2.5 rounded text-left font-medium transition-all ${editTab === "users" ? 'bg-[#3E8ED0] text-white shadow-lg' : 'text-neutral-400 hover:bg-[#323232] hover:text-neutral-200'}`}
                           >
                              <Users className="w-4 h-4" />
                              User Management
                           </button>
                        </div>

                        <div className="mt-auto pt-4 flex flex-col gap-2">
                           {JSON.stringify(config) !== originalConfig && (
                              <div className="text-[10px] text-amber-500 font-bold mb-1 flex items-center gap-1 animate-pulse">
                                 <AlertCircle className="w-3 h-3" /> Unsaved Changes
                              </div>
                           )}
                           {!isGlobalBrowser && (
                              <button
                                 onClick={handleSaveConfig}
                                 disabled={isSaving || JSON.stringify(config) === originalConfig}
                                 className={`w-full flex items-center justify-center gap-2 font-bold py-2 rounded shadow-lg transition-all ${JSON.stringify(config) === originalConfig
                                       ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed opacity-50'
                                       : 'bg-[#3E8ED0] hover:bg-[#2B6A9E] text-white'
                                    }`}
                              >
                                 {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                 Save Changes
                              </button>
                           )}
                        </div>
                     </div>

                     {/* Main Area */}
                     <div className="flex-1 bg-[#1A1A1A] flex flex-col min-w-0 overflow-hidden">
                        {editTab === "logs" && (
                           <div className="flex flex-col h-full bg-[#181818] overflow-hidden">
                              {/* Header with Title, Checkboxes, and Actions */}
                              <div className="flex flex-wrap justify-between items-center gap-3 px-5 py-3 border-b border-[#2C2C2C] bg-[#222222]">
                                 <div className="flex flex-wrap items-center gap-5">
                                    <div className="flex items-center gap-2">
                                       <Terminal className="w-5 h-5 text-[#3E8ED0]" />
                                       <span className="text-base font-bold text-white">Minecraft Log</span>
                                    </div>
                                    <div className="flex items-center gap-4 text-xs select-none">
                                       <label className="flex items-center gap-1.5 cursor-pointer text-neutral-300 hover:text-white transition-colors">
                                          <input
                                             type="checkbox"
                                             checked={logKeepUpdating}
                                             onChange={(e) => setLogKeepUpdating(e.target.checked)}
                                             className="w-4 h-4 rounded border-[#404040] bg-[#1A1A1A] text-[#3E8ED0] accent-[#3E8ED0] cursor-pointer"
                                          />
                                          <span>Keep updating</span>
                                       </label>
                                       <label className="flex items-center gap-1.5 cursor-pointer text-neutral-300 hover:text-white transition-colors">
                                          <input
                                             type="checkbox"
                                             checked={logWrapLines}
                                             onChange={(e) => setLogWrapLines(e.target.checked)}
                                             className="w-4 h-4 rounded border-[#404040] bg-[#1A1A1A] text-[#3E8ED0] accent-[#3E8ED0] cursor-pointer"
                                          />
                                          <span>Wrap lines</span>
                                       </label>
                                       <label className="flex items-center gap-1.5 cursor-pointer text-neutral-300 hover:text-white transition-colors">
                                          <input
                                             type="checkbox"
                                             checked={logColorLines}
                                             onChange={(e) => setLogColorLines(e.target.checked)}
                                             className="w-4 h-4 rounded border-[#404040] bg-[#1A1A1A] text-[#3E8ED0] accent-[#3E8ED0] cursor-pointer"
                                          />
                                          <span>Color lines</span>
                                       </label>
                                    </div>
                                 </div>

                                 <div className="flex items-center gap-2.5">
                                    <div className="flex bg-[#141414] border border-[#333] p-0.5 rounded">
                                       <button
                                          onClick={() => setIsVerbose(false)}
                                          className={`px-2.5 py-1 rounded text-[11px] font-medium transition-all ${!isVerbose ? 'bg-[#3E8ED0] text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'}`}
                                       >
                                          Simplified
                                       </button>
                                       <button
                                          onClick={() => setIsVerbose(true)}
                                          className={`px-2.5 py-1 rounded text-[11px] font-medium transition-all ${isVerbose ? 'bg-[#3E8ED0] text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'}`}
                                       >
                                          Verbose
                                       </button>
                                    </div>
                                    <button
                                       onClick={handleCopyLogs}
                                       className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2D2D2D] hover:bg-[#3D3D3D] text-neutral-200 hover:text-white border border-[#404040] rounded text-xs font-medium transition-colors cursor-pointer"
                                       title="Copy log output to clipboard"
                                    >
                                       {logCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                       <span>{logCopied ? "Copied" : "Copy"}</span>
                                    </button>
                                    <button
                                       onClick={handleClearLogs}
                                       className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2D2D2D] hover:bg-[#3D3D3D] text-neutral-200 hover:text-white border border-[#404040] rounded text-xs font-medium transition-colors cursor-pointer"
                                       title="Clear console view"
                                    >
                                       <Trash2 className="w-3.5 h-3.5" />
                                       <span>Clear</span>
                                    </button>
                                    <button
                                       onClick={() => {
                                          if (selectedInstance) {
                                             setClearedLogsOffset(prev => ({ ...prev, [selectedInstance.id]: 0 }));
                                             fetchLogs(selectedInstance.id);
                                          }
                                       }}
                                       className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2D2D2D] hover:bg-[#3D3D3D] text-neutral-200 hover:text-white border border-[#404040] rounded text-xs font-medium transition-colors cursor-pointer"
                                       title="Refresh logs from server"
                                    >
                                       <RefreshCw className={`w-3.5 h-3.5 ${isLogsLoading ? 'animate-spin text-[#3E8ED0]' : ''}`} />
                                       <span>Refresh</span>
                                    </button>
                                 </div>
                              </div>

                              {/* Console Log Pre View */}
                              <pre
                                 ref={scrollRef}
                                 className={`flex-1 bg-[#0D0D0D] p-4 overflow-auto text-xs font-mono selection:bg-[#3E8ED0]/40 shadow-inner scrollbar-custom ${
                                    logWrapLines ? 'whitespace-pre-wrap break-words' : 'whitespace-pre overflow-x-auto'
                                 }`}
                              >
                                 {displayLogLines.length === 0 ? (
                                    <span className="text-neutral-500 italic">
                                       {logs ? "No logs match current filter." : "Waiting for output..."}
                                    </span>
                                 ) : (
                                    displayLogLines.map((line, idx) => {
                                       const isCommand = /issued (server )?command/i.test(line) || line.includes('> ');
                                       const isError = /(\bERROR\b|\bFATAL\b|Exception|Severe|Crash)/i.test(line);
                                       const isWarn = /(\bWARN\b|\bWARNING\b)/i.test(line);
                                       const isPlayer = /(joined the game|left the game)/i.test(line);
                                       const isLauncherMeta = /(Prism Launcher|version:|Launched instance|resolves to|folder is|Java path|Java is version|OS:|CPU:|RAM:|Vulkan device|OpenGL|Starting minecraft server)/i.test(line);
                                       const isInfo = /\[Server thread\/INFO\]/i.test(line) || /\[INFO\]/i.test(line);

                                       const isCurrentMatch = matchingLineIndices.length > 0 && matchingLineIndices[currentMatchIndex] === idx;
                                       const isMatch = matchingLineIndices.includes(idx);

                                       let lineStyle = "text-neutral-300";
                                       let containerStyle = "";

                                       if (logColorLines) {
                                          if (isCommand) {
                                             lineStyle = "text-[#4ADE80] font-semibold";
                                             containerStyle = "bg-[#14532D]/30 border border-emerald-800/30 px-1.5 py-0.5 rounded my-0.5";
                                          } else if (isError) {
                                             lineStyle = "text-[#F87171] font-semibold";
                                             containerStyle = "bg-[#7F1D1D]/25 border border-red-900/30 px-1.5 py-0.5 rounded my-0.5";
                                          } else if (isWarn) {
                                             lineStyle = "text-[#FBBF24]";
                                             containerStyle = "bg-[#78350F]/20 border border-amber-900/30 px-1.5 py-0.5 rounded my-0.5";
                                          } else if (isPlayer) {
                                             lineStyle = "text-[#2DD4BF] font-medium";
                                          } else if (isLauncherMeta) {
                                             lineStyle = "text-[#C084FC] font-medium";
                                          } else if (isInfo) {
                                             lineStyle = "text-[#60A5FA]";
                                          }
                                       }

                                       let matchHighlight = "";
                                       if (isCurrentMatch) {
                                          matchHighlight = " ring-2 ring-yellow-400 bg-yellow-500/20";
                                       } else if (isMatch) {
                                          matchHighlight = " bg-yellow-500/10";
                                       }

                                       let content: React.ReactNode = line;
                                       if (logSearchQuery.trim() && isMatch) {
                                          const escaped = logSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                          const parts = line.split(new RegExp(`(${escaped})`, 'gi'));
                                          content = parts.map((part, pIdx) => {
                                             if (part.toLowerCase() === logSearchQuery.toLowerCase()) {
                                                return (
                                                   <mark
                                                      key={pIdx}
                                                      className={`${
                                                         isCurrentMatch
                                                            ? 'bg-yellow-400 text-neutral-950 font-bold ring-1 ring-yellow-300'
                                                            : 'bg-yellow-500/50 text-yellow-100 font-semibold'
                                                      } rounded px-0.5 py-0`}
                                                   >
                                                      {part}
                                                   </mark>
                                                );
                                             }
                                             return part;
                                          });
                                       }

                                       return (
                                          <div
                                             key={idx}
                                             id={`log-line-${idx}`}
                                             className={`block leading-relaxed ${lineStyle} ${containerStyle}${matchHighlight}`}
                                          >
                                             {content}
                                          </div>
                                       );
                                    })
                                 )}
                              </pre>

                              {/* Search, Find, and Bottom Navigation Row */}
                              <div className="flex items-center gap-2 bg-[#202020] border-t border-[#2C2C2C] px-4 py-2.5">
                                 <div className="relative flex-1">
                                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                                    <input
                                       type="text"
                                       placeholder="Search"
                                       value={logSearchQuery}
                                       onChange={(e) => {
                                          setLogSearchQuery(e.target.value);
                                          setCurrentMatchIndex(0);
                                       }}
                                       onKeyDown={(e) => {
                                          if (e.key === "Enter") {
                                             e.preventDefault();
                                             handleFindNext();
                                          }
                                       }}
                                       className="w-full bg-[#141414] border border-[#333] pl-9 pr-24 py-1.5 rounded text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-[#3E8ED0]"
                                    />
                                    {logSearchQuery.trim() && (
                                       <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-neutral-400 font-mono select-none">
                                          {matchingLineIndices.length > 0
                                             ? `${currentMatchIndex + 1} of ${matchingLineIndices.length}`
                                             : "No match"}
                                       </span>
                                    )}
                                 </div>
                                 <button
                                    onClick={handleFindNext}
                                    disabled={matchingLineIndices.length === 0}
                                    className="px-4 py-1.5 bg-[#2D2D2D] hover:bg-[#3D3D3D] disabled:opacity-40 disabled:hover:bg-[#2D2D2D] text-neutral-200 hover:text-white border border-[#404040] rounded text-xs font-medium transition-colors select-none cursor-pointer"
                                 >
                                    Find
                                 </button>
                                 <button
                                    onClick={handleScrollToBottom}
                                    className="px-4 py-1.5 bg-[#2D2D2D] hover:bg-[#3D3D3D] text-neutral-200 hover:text-white border border-[#404040] rounded text-xs font-medium transition-colors select-none cursor-pointer"
                                 >
                                    Bottom
                                 </button>
                              </div>

                              {/* Command Input Row */}
                              <div className="flex bg-[#1A1A1A] p-3 gap-3 border-t border-[#2C2C2C]">
                                 <input
                                    type="text"
                                    placeholder="Type a command (whitelist, op, kick...)"
                                    className="flex-1 bg-[#121212] border border-[#333] px-3 py-2 rounded text-emerald-400 font-mono text-sm focus:outline-none focus:border-[#3E8ED0]"
                                    value={consoleCommand}
                                    onChange={(e) => setConsoleCommand(e.target.value)}
                                    onKeyDown={(e) => {
                                       if (e.key === 'Enter') {
                                          handleSendCommand(selectedInstance?.id || "", consoleCommand);
                                       } else if (e.key === 'ArrowUp') {
                                          e.preventDefault();
                                          if (commandHistory.length === 0) return;

                                          let nextIndex = historyIndex;
                                          if (historyIndex === -1) {
                                             setCommandDraft(consoleCommand);
                                             nextIndex = commandHistory.length - 1;
                                          } else if (historyIndex > 0) {
                                             nextIndex = historyIndex - 1;
                                          }
                                          setHistoryIndex(nextIndex);
                                          setConsoleCommand(commandHistory[nextIndex]);
                                       } else if (e.key === 'ArrowDown') {
                                          e.preventDefault();
                                          if (historyIndex === -1) return;

                                          if (historyIndex < commandHistory.length - 1) {
                                             const nextIndex = historyIndex + 1;
                                             setHistoryIndex(nextIndex);
                                             setConsoleCommand(commandHistory[nextIndex]);
                                          } else {
                                             setHistoryIndex(-1);
                                             setConsoleCommand(commandDraft);
                                          }
                                       }
                                    }}
                                    disabled={isExecuting}
                                 />
                                 <button
                                    onClick={() => handleSendCommand(selectedInstance?.id || "", consoleCommand)}
                                    disabled={isExecuting}
                                    className="px-4 py-2 bg-[#2D2D2D] hover:bg-[#3D3D3D] rounded text-xs font-bold text-neutral-300 hover:text-white transition-colors flex items-center gap-2 border border-[#404040] cursor-pointer"
                                 >
                                    {isExecuting ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#3E8ED0]" /> : <Terminal className="w-3.5 h-3.5" />}
                                    Send
                                 </button>
                              </div>
                           </div>
                        )}

                        {editTab === "users" && (
                           <div className="flex flex-col h-full p-8 overflow-auto scrollbar-custom text-[#E0E0E0]">
                              <div className="max-w-4xl w-full mx-auto space-y-6">
                                 {/* Header with Whitelist Toggle */}
                                 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[#2D2D2D]">
                                    <div className="flex items-center gap-3">
                                       <div className="p-2.5 rounded-xl bg-[#3E8ED0]/10 border border-[#3E8ED0]/30 text-[#3E8ED0]">
                                          <Users className="w-6 h-6" />
                                       </div>
                                       <div>
                                          <h3 className="text-xl font-bold tracking-tight">User Management</h3>
                                          <p className="text-xs text-neutral-400">Manage player access, whitelist gating, and operator permissions.</p>
                                       </div>
                                    </div>

                                    {/* Whitelist (On/Off) Toggle Switch */}
                                    <div className="flex items-center gap-3 bg-[#242424] border border-[#3A3A3A] px-4 py-2.5 rounded-xl shadow-lg">
                                       <div className="flex items-center gap-2">
                                          <Shield className={`w-4 h-4 transition-colors ${config.environment["ENABLE_WHITELIST"]?.toLowerCase() === "true" ? 'text-amber-400' : 'text-neutral-500'}`} />
                                          <div className="flex flex-col">
                                             <span className="text-xs font-bold text-neutral-200 uppercase tracking-wider">Whitelist</span>
                                             <span className="text-[10px] text-neutral-500 font-medium">Access Restriction</span>
                                          </div>
                                       </div>
                                       <button
                                          type="button"
                                          onClick={() => setConfig(prev => ({
                                             ...prev,
                                             environment: {
                                                ...prev.environment,
                                                ENABLE_WHITELIST: prev.environment["ENABLE_WHITELIST"] === "true" ? "false" : "true"
                                             }
                                          }))}
                                          aria-label="Toggle Whitelist"
                                          className={`w-12 h-6 rounded-full transition-all relative outline-none focus:ring-2 focus:ring-[#3E8ED0]/40 ${config.environment["ENABLE_WHITELIST"]?.toLowerCase() === "true" ? 'bg-amber-500 shadow-md shadow-amber-500/25' : 'bg-neutral-800 border border-neutral-700'
                                             }`}
                                       >
                                          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow ${config.environment["ENABLE_WHITELIST"]?.toLowerCase() === "true" ? 'left-7' : 'left-1'
                                             }`} />
                                       </button>
                                       <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold border transition-all ${config.environment["ENABLE_WHITELIST"]?.toLowerCase() === "true"
                                             ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                                             : 'bg-neutral-800 border-neutral-700 text-neutral-500'
                                          }`}>
                                          {config.environment["ENABLE_WHITELIST"]?.toLowerCase() === "true" ? 'ON' : 'OFF'}
                                       </span>
                                    </div>
                                 </div>

                                 {/* State Notification Banner */}
                                 {config.environment["ENABLE_WHITELIST"]?.toLowerCase() === "true" ? (
                                    <div className="flex items-center gap-3 p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300">
                                       <Shield className="w-4 h-4 text-amber-400 shrink-0" />
                                       <div>
                                          <span className="font-bold">Whitelist Gating Active:</span> Only explicitly whitelisted and active players listed below are permitted to join this server.
                                       </div>
                                    </div>
                                 ) : (
                                    <div className="flex items-center gap-3 p-3.5 bg-[#242424] border border-[#3A3A3A] rounded-xl text-xs text-neutral-400">
                                       <Users className="w-4 h-4 text-neutral-500 shrink-0" />
                                       <div>
                                          <span className="font-bold text-neutral-300">Standard Access Active:</span> Whitelist gating is disabled. Standard user access rules apply without whitelist gating.
                                       </div>
                                    </div>
                                 )}

                                 {/* Add Player Section (Fully functional regardless of whitelist state) */}
                                 <div className="bg-[#242424] border border-[#3A3A3A] rounded-xl shadow-xl relative z-20">
                                    <div className="px-4 py-3 bg-[#2D2D2D] border-b border-[#3A3A3A] flex justify-between items-center bg-gradient-to-r from-[#2D2D2D] to-[#242424] rounded-t-xl">
                                       <span className="text-xs font-bold text-neutral-200 uppercase tracking-wider">Add Player</span>
                                    </div>
                                    <div className="p-5 space-y-4">
                                       <div className="flex gap-2">
                                          <div className="relative flex-1 group">
                                             <div className="absolute left-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded bg-[#1A1A1A] border border-[#333] flex items-center justify-center overflow-hidden">
                                                {userSearchPreview ? (
                                                   <img
                                                      src={getPlayerAvatarUrl(userSearchPreview.uuid || userSearchPreview.name, 32)}
                                                      referrerPolicy="no-referrer"
                                                      alt=""
                                                      className="w-full h-full"
                                                      onError={(e) => {
                                                         e.currentTarget.src = `https://crafthead.net/avatar/${userSearchPreview.name}/32`;
                                                      }}
                                                   />
                                                ) : (
                                                   <Users className="w-3 h-3 text-neutral-600" />
                                                )}
                                             </div>
                                             <input
                                                type="text"
                                                value={userSearchText}
                                                onFocus={() => setIsUserSearchFocused(true)}
                                                onBlur={() => setTimeout(() => setIsUserSearchFocused(false), 200)}
                                                onChange={(e) => setUserSearchText(e.target.value)}
                                                onKeyDown={(e) => {
                                                   if (e.key === 'Tab' && userSearchSuggestions.length > 0) {
                                                      e.preventDefault();
                                                      const first = userSearchSuggestions[0];
                                                      setUserSearchText(first.name);
                                                      setUserSearchPreview({ name: first.name, uuid: first.uuid || "" });
                                                      return;
                                                   }
                                                   if (e.key === 'Enter' && userSearchText.trim()) {
                                                      const targetName = userSearchPreview ? userSearchPreview.name : userSearchText.trim();
                                                      const targetUuid = userSearchPreview ? userSearchPreview.uuid : undefined;
                                                      if (!instanceUsers.some(u => u.name.toLowerCase() === targetName.toLowerCase())) {
                                                         setInstanceUsers(prev => [
                                                            ...prev,
                                                            {
                                                               name: targetName,
                                                               uuid: targetUuid,
                                                               level: 0,
                                                               is_op: false,
                                                               whitelisted: true,
                                                               active: true
                                                            }
                                                         ]);
                                                         setSeenPlayers(prev => {
                                                            if (prev.find(x => x.name.toLowerCase() === targetName.toLowerCase())) return prev;
                                                            return [{ name: targetName, uuid: targetUuid || targetName }, ...prev].slice(0, 50);
                                                         });
                                                      }
                                                      setUserSearchText("");
                                                      setUserSearchPreview(null);
                                                      setIsUserSearchFocused(false);
                                                   }
                                                }}
                                                placeholder="Minecraft Gamertag..."
                                                className="w-full bg-[#1A1A1A] border border-[#333] pl-12 pr-4 py-3 rounded-lg focus:outline-none focus:border-[#3E8ED0]/60 text-sm placeholder:text-neutral-700 transition-all font-medium text-neutral-200"
                                             />
                                             {isUserSearchVerifying && (
                                                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                   <RefreshCw className="w-3.5 h-3.5 animate-spin text-neutral-600" />
                                                </div>
                                             )}
                                             {userSearchPreview && (
                                                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[#3E8ED0]/80 bg-[#3E8ED0]/10 px-2 py-0.5 rounded border border-[#3E8ED0]/30">
                                                   FOUND
                                                </div>
                                             )}

                                             {/* Autocomplete Dropdown (2-3 gamertags) */}
                                             {isUserSearchFocused && userSearchText.trim().length >= 1 && userSearchSuggestions.length > 0 && (
                                                <div className="absolute top-full left-0 right-0 mt-2 bg-[#1C1C1C] border-2 border-[#3E8ED0]/70 rounded-xl shadow-[0_16px_45px_rgba(0,0,0,0.95)] z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                                                   <div className="px-4 py-2.5 bg-[#252525] border-b border-[#353535] flex justify-between items-center text-[10px] font-bold text-neutral-300 uppercase tracking-wider">
                                                      <span className="flex items-center gap-1.5 text-[#3E8ED0]">
                                                         <Users className="w-3.5 h-3.5" />
                                                         Suggested Gamertags ({userSearchSuggestions.length})
                                                      </span>
                                                      <span className="text-neutral-500 font-normal">Click or Tab to autocomplete</span>
                                                   </div>
                                                   <div className="divide-y divide-[#2B2B2B]">
                                                      {userSearchSuggestions.map((sug: { name: string; uuid?: string }) => (
                                                         <div
                                                            key={sug.name}
                                                            onMouseDown={(e) => {
                                                               e.preventDefault();
                                                               setUserSearchText(sug.name);
                                                               setUserSearchPreview({ name: sug.name, uuid: sug.uuid || "" });
                                                               setIsUserSearchFocused(false);
                                                            }}
                                                            className="flex items-center gap-3.5 px-4 py-3 hover:bg-[#2A2A2A] cursor-pointer transition-colors group"
                                                         >
                                                            <img
                                                               src={getPlayerAvatarUrl(sug.uuid || sug.name, 32)}
                                                               alt=""
                                                               className="w-7 h-7 rounded-md border border-[#444] shadow-sm shrink-0 bg-[#141414]"
                                                               onError={(e) => {
                                                                  e.currentTarget.src = `https://crafthead.net/avatar/${sug.name}/32`;
                                                               }}
                                                            />
                                                            <div className="flex flex-col min-w-0">
                                                               <span className="text-sm font-bold text-neutral-200 group-hover:text-white truncate">
                                                                  {sug.name}
                                                               </span>
                                                               {sug.uuid && <span className="text-[10px] font-mono text-neutral-500 truncate">{sug.uuid}</span>}
                                                            </div>
                                                            <div className="ml-auto flex items-center">
                                                               <span className="text-[10px] font-bold text-[#3E8ED0] bg-[#3E8ED0]/15 px-2.5 py-1 rounded-md border border-[#3E8ED0]/30 group-hover:bg-[#3E8ED0] group-hover:text-white transition-all shadow-sm">
                                                                  Autocomplete
                                                               </span>
                                                            </div>
                                                         </div>
                                                      ))}
                                                   </div>
                                                </div>
                                             )}
                                          </div>
                                          <button
                                             onClick={() => {
                                                if (userSearchText.trim()) {
                                                   const targetName = userSearchPreview ? userSearchPreview.name : userSearchText.trim();
                                                   const targetUuid = userSearchPreview ? userSearchPreview.uuid : undefined;
                                                   if (!instanceUsers.some(u => u.name.toLowerCase() === targetName.toLowerCase())) {
                                                      setInstanceUsers(prev => [
                                                         ...prev,
                                                         {
                                                            name: targetName,
                                                            uuid: targetUuid,
                                                            level: 0,
                                                            is_op: false,
                                                            whitelisted: true,
                                                            active: true
                                                         }
                                                      ]);
                                                      setSeenPlayers(prev => {
                                                         if (prev.find(x => x.name.toLowerCase() === targetName.toLowerCase())) return prev;
                                                         return [{ name: targetName, uuid: targetUuid || targetName }, ...prev].slice(0, 50);
                                                      });
                                                   }
                                                   setUserSearchText("");
                                                   setUserSearchPreview(null);
                                                   setIsUserSearchFocused(false);
                                                }
                                             }}
                                             className="px-6 py-2 bg-[#3E8ED0] hover:bg-[#2B6A9E] rounded-lg text-sm font-bold transition-all text-white shadow-md shadow-[#3E8ED0]/15"
                                          >
                                             Add Player
                                          </button>
                                       </div>
                                    </div>
                                 </div>

                                 {/* Players List Table */}
                                 <div className="bg-[#242424] border border-[#3A3A3A] rounded-xl overflow-hidden shadow-xl">
                                    <div className="px-4 py-3 bg-[#2D2D2D] border-b border-[#3A3A3A] flex justify-between items-center bg-gradient-to-r from-[#2D2D2D] to-[#242424]">
                                       <span className="text-xs font-bold text-neutral-200 uppercase tracking-wider">Managed Players ({instanceUsers.length})</span>
                                    </div>

                                    {isUsersLoading ? (
                                       <div className="flex flex-col items-center justify-center py-12 gap-3">
                                          <RefreshCw className="w-8 h-8 text-[#3E8ED0] animate-spin" />
                                          <span className="text-xs text-neutral-500">Loading user lists...</span>
                                       </div>
                                    ) : instanceUsers.length === 0 ? (
                                       <div className="flex flex-col items-center justify-center py-12 text-neutral-600 text-sm gap-2">
                                          <Users className="w-8 h-8 opacity-20" />
                                          <span className="italic">No players configured on this server.</span>
                                       </div>
                                    ) : (
                                       <div className="overflow-x-auto">
                                          <table className="w-full text-left border-collapse text-xs">
                                             <thead>
                                                <tr className="border-b border-[#2D2D2D] text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
                                                   <th className="px-5 py-3.5">Player</th>
                                                   <th className="px-5 py-3.5">Account Status</th>
                                                   <th className="px-5 py-3.5">Whitelist</th>
                                                   <th className="px-5 py-3.5">Operator (OP) Level</th>
                                                   <th className="px-5 py-3.5 text-right">Actions</th>
                                                </tr>
                                             </thead>
                                             <tbody className="divide-y divide-[#2D2D2D]">
                                                {instanceUsers.map((user, idx) => (
                                                   <tr key={user.name} className={`hover:bg-[#2A2A2A]/40 transition-colors ${user.active === false ? 'opacity-60 bg-black/20' : ''}`}>
                                                      <td className="px-5 py-3 flex items-center gap-3">
                                                         <img
                                                            src={getPlayerAvatarUrl(user.uuid || user.name, 32)}
                                                            alt=""
                                                            className="w-7 h-7 rounded bg-[#141414] border border-[#333]"
                                                            onError={(e) => {
                                                               e.currentTarget.src = `https://crafthead.net/avatar/${user.name}/32`;
                                                            }}
                                                         />
                                                         <div className="flex flex-col">
                                                            <span className={`text-sm font-bold ${user.active === false ? 'text-neutral-500 line-through' : 'text-neutral-200'}`}>{user.name}</span>
                                                            {user.uuid && <span className="text-[9px] font-mono text-neutral-600">{user.uuid}</span>}
                                                         </div>
                                                      </td>
                                                      <td className="px-5 py-3">
                                                         <button
                                                            type="button"
                                                            onClick={() => {
                                                               setInstanceUsers(prev => prev.map((u, i) => i === idx ? { ...u, active: u.active === false ? true : false } : u));
                                                            }}
                                                            className={`px-3 py-1 rounded text-[10px] font-bold transition-all border ${user.active !== false
                                                                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25'
                                                                  : 'bg-rose-500/15 border-rose-500/40 text-rose-400 hover:bg-rose-500/25'
                                                               }`}
                                                            title={user.active !== false ? "Click to deactivate player access" : "Click to activate player access"}
                                                         >
                                                            {user.active !== false ? 'ACTIVE' : 'DEACTIVATED'}
                                                         </button>
                                                      </td>
                                                      <td className="px-5 py-3">
                                                         <button
                                                            type="button"
                                                            onClick={() => {
                                                               setInstanceUsers(prev => prev.map((u, i) => i === idx ? { ...u, whitelisted: !u.whitelisted } : u));
                                                            }}
                                                            className={`px-3 py-1 rounded text-[10px] font-bold transition-all border ${user.whitelisted
                                                                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-400 hover:bg-amber-500/30'
                                                                  : 'bg-neutral-800 border-neutral-700 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-300'
                                                               }`}
                                                            title="Toggle player whitelist eligibility"
                                                         >
                                                            {user.whitelisted ? 'WHITELISTED' : 'NOT WHITELISTED'}
                                                         </button>
                                                      </td>
                                                      <td className="px-5 py-3">
                                                         <select
                                                            value={user.is_op ? user.level : 0}
                                                            onChange={(e) => {
                                                               const val = parseInt(e.target.value);
                                                               setInstanceUsers(prev => prev.map((u, i) => i === idx ? {
                                                                  ...u,
                                                                  is_op: val > 0,
                                                                  level: val
                                                               } : u));
                                                            }}
                                                            className="bg-[#141414] border border-[#333] p-1.5 rounded text-xs text-neutral-300 focus:outline-none focus:border-[#3E8ED0]/40"
                                                         >
                                                            <option value={0}>Standard Player (No OP)</option>
                                                            <option value={1}>Level 1: Bypass Spawn Protection</option>
                                                            <option value={2}>Level 2: Cheat Commands / Command Blocks</option>
                                                            <option value={3}>Level 3: Kick, Ban, Promote</option>
                                                            <option value={4}>Level 4: Full Operator</option>
                                                         </select>
                                                      </td>
                                                      <td className="px-5 py-3 text-right">
                                                         <button
                                                            type="button"
                                                            onClick={() => {
                                                               setInstanceUsers(prev => prev.filter((_, i) => i !== idx));
                                                            }}
                                                            className="p-1.5 bg-[#3D2525]/30 hover:bg-red-500/20 text-red-400 rounded border border-red-500/20 transition-all"
                                                            title="Remove player"
                                                         >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                         </button>
                                                      </td>
                                                   </tr>
                                                ))}
                                             </tbody>
                                          </table>
                                       </div>
                                    )}
                                 </div>

                                 {/* Save Panel */}
                                 <div className="flex justify-end gap-3 pt-4 border-t border-[#3A3A3A]">
                                    <button
                                       type="button"
                                       onClick={() => fetchInstanceUsers(selectedInstance?.id || "")}
                                       className="px-5 py-2.5 rounded-lg text-neutral-400 hover:bg-[#323232] hover:text-white font-bold transition-all text-xs"
                                    >
                                       Discard Changes
                                    </button>
                                    <button
                                       type="button"
                                       onClick={() => saveInstanceUsers(selectedInstance?.id || "")}
                                       disabled={isUsersSaving}
                                       className="px-6 py-2.5 bg-[#3E8ED0] hover:bg-[#2B6A9E] text-white rounded-lg font-bold text-xs shadow-md shadow-[#3E8ED0]/15 transition-all flex items-center gap-2"
                                    >
                                       {isUsersSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                       Save User Configuration
                                    </button>
                                 </div>

                              </div>
                           </div>
                        )}

                        {editTab === "version" && (
                           <div className="flex flex-col h-full p-8 max-w-2xl mx-auto w-full">
                              <div className="flex flex-col gap-6">
                                 <div>
                                    <h3 className="text-xl font-bold mb-2 flex items-center gap-2">
                                       <Database className="text-[#3E8ED0]" /> Minecraft Version
                                    </h3>
                                    <p className="text-neutral-400 text-sm mb-6">Select the base version of Minecraft for this instance. This will pull the appropriate server JAR.</p>
                                 </div>

                                 <div className="space-y-4">
                                    <label className="block text-sm font-medium text-neutral-300">Current Version</label>
                                    <div className="flex gap-2">
                                       <input
                                          type="text"
                                          className="flex-1 bg-[#141414] border border-[#3A3A3A] p-3 rounded focus:outline-none focus:border-[#3E8ED0] text-[#E0E0E0] font-mono"
                                          value={config.environment["VERSION"] || "latest"}
                                          onChange={(e) => setConfig(prev => ({
                                             ...prev,
                                             environment: { ...prev.environment, VERSION: e.target.value }
                                          }))}
                                          placeholder="latest"
                                       />
                                    </div>

                                    <div className="bg-[#242424] border border-[#3A3A3A] rounded-lg overflow-hidden h-72 flex flex-col">
                                       <div className="p-3 bg-[#2D2D2D] border-b border-[#3A3A3A] flex justify-between items-center">
                                          <span className="text-xs font-bold text-neutral-400 uppercase tracking-widest">Available Versions</span>
                                          <div className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20">Official Manifest</div>
                                       </div>
                                       <div className="overflow-auto flex-1">
                                          {mcVersions.length === 0 ? (
                                             <div className="p-8 text-center text-neutral-500 italic">Loading versions...</div>
                                          ) : (
                                             mcVersions.slice(0, 50).map((v: any) => (
                                                <div
                                                   key={v.id}
                                                   onClick={() => handleVersionClick(v.id)}
                                                   className={`px-4 py-2.5 flex items-center justify-between cursor-pointer border-b border-[#2D2D2D] transition-colors ${config.environment["VERSION"] === v.id ? 'bg-[#3E8ED0]/20 text-[#3E8ED0]' : 'hover:bg-[#2D2D2D]'}`}
                                                >
                                                   <span className="font-mono text-sm">{v.id}</span>
                                                   <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-bold ${v.type === 'release' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-orange-500/20 text-orange-400'}`}>
                                                      {v.type}
                                                   </span>
                                                </div>
                                             ))
                                          )}
                                       </div>
                                    </div>
                                    <p className="text-xs text-neutral-500 mt-2">Showing the 50 most recent versions from Mojang manifest.</p>
                                 </div>
                              </div>
                           </div>
                        )}

                        {editTab === "loader" && (
                           <div className="flex flex-col h-full p-8 max-w-2xl mx-auto w-full overflow-auto scrollbar-custom">
                              <div className="flex flex-col gap-6 text-neutral-300">
                                 <div>
                                    <h3 className="text-xl font-bold mb-2 flex items-center gap-2">
                                       <Cpu className="text-[#3E8ED0]" /> Mod Loader
                                    </h3>
                                    <p className="text-neutral-400 text-sm">Choose how Minecraft should load its mods. Vanilla has no mod support.</p>
                                 </div>

                                 <div className="grid grid-cols-2 gap-4">
                                    {[
                                       { id: "VANILLA", name: "Vanilla", icon: Gamepad2, desc: "Standard Minecraft experience" },
                                       { id: "FABRIC", name: "Fabric", icon: Cpu, desc: "Lightweight and modular" },
                                       { id: "FORGE", name: "Forge", icon: Settings, desc: "Traditional and powerful" },
                                       { id: "QUILT", name: "Quilt", icon: RefreshCw, desc: "The open community loader" },
                                       { id: "NEOFORGE", name: "NeoForge", icon: Layers, desc: "Modern community fork" }
                                    ].map((l) => (
                                       <div
                                          key={l.id}
                                          onClick={() => setConfig(prev => ({
                                             ...prev,
                                             environment: { ...prev.environment, TYPE: l.id }
                                          }))}
                                          className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${config.environment["TYPE"] === l.id ? 'border-[#3E8ED0] bg-[#3E8ED0]/10' : 'border-[#333] hover:border-[#444] bg-[#222]'}`}
                                       >
                                          <div className="flex items-center gap-3 mb-2">
                                             <l.icon className={`w-5 h-5 ${config.environment["TYPE"] === l.id ? 'text-[#3E8ED0]' : 'text-neutral-500'}`} />
                                             <span className="font-bold">{l.name}</span>
                                          </div>
                                          <p className="text-xs text-neutral-500 leading-tight">{l.desc}</p>
                                       </div>
                                    ))}
                                 </div>

                                 {config.environment["TYPE"] !== "VANILLA" && (
                                    <>
                                       <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-lg flex items-start gap-2.5 text-xs text-amber-400">
                                          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                          <p>Warning: Changing the mod loader type or version may cause existing mods to stop loading or fail to start. Ensure your mods are compatible with the selected loader and version.</p>
                                       </div>

                                       <div className="bg-[#242424] border border-[#3A3A3A] rounded-lg overflow-hidden h-60 flex flex-col">
                                          <div className="grid grid-cols-2 px-4 py-2.5 border-b border-[#3A3A3A] bg-[#2D2D2D] text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
                                             <div>Loader Version</div>
                                             <div className="text-right">Status</div>
                                          </div>
                                          <div className="flex-1 overflow-auto relative">
                                             {isLoaderLoading ? (
                                                <div className="absolute inset-0 flex items-center justify-center bg-[#0F0F0F]/50">
                                                   <div className="flex flex-col items-center gap-3">
                                                      <RefreshCw className="w-5 h-5 text-[#3E8ED0] animate-spin" />
                                                      <span className="text-[10px] text-neutral-500">Scanning versions...</span>
                                                   </div>
                                                </div>
                                             ) : (
                                                <div className="divide-y divide-[#1A1A1A]">
                                                   <div
                                                      onClick={() => setConfig(prev => ({
                                                         ...prev,
                                                         environment: { ...prev.environment, LOADER_VERSION: "latest" }
                                                      }))}
                                                      className={`grid grid-cols-2 px-4 py-2 text-sm cursor-pointer transition-all ${(!config.environment["LOADER_VERSION"] || config.environment["LOADER_VERSION"] === 'latest') ? 'bg-[#3E8ED0]/20 text-[#3E8ED0] border-l-2 border-l-[#3E8ED0]' : 'text-neutral-400 hover:bg-[#222]'}`}
                                                   >
                                                      <div className="font-bold italic">Latest Recommended</div>
                                                      <div className="text-right text-[10px] opacity-60">AUTO</div>
                                                   </div>
                                                   {loaderVersions.map((lv) => (
                                                      <div
                                                         key={lv.id}
                                                         onClick={() => setConfig(prev => ({
                                                            ...prev,
                                                            environment: { ...prev.environment, LOADER_VERSION: lv.id }
                                                         }))}
                                                         className={`grid grid-cols-2 px-4 py-2 text-sm font-mono cursor-pointer transition-all ${config.environment["LOADER_VERSION"] === lv.id ? 'bg-[#3E8ED0]/20 text-[#3E8ED0] border-l-2 border-l-[#3E8ED0]' : 'text-neutral-400 hover:bg-[#222]'}`}
                                                      >
                                                         <div>{lv.id}</div>
                                                         <div className="text-right">
                                                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${lv.stable ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'}`}>
                                                               {lv.stable ? 'STABLE' : 'UNSTABLE'}
                                                            </span>
                                                         </div>
                                                      </div>
                                                   ))}
                                                </div>
                                             )}
                                          </div>
                                       </div>
                                    </>
                                 )}
                              </div>
                           </div>
                        )}

                        {editTab === "backups" && selectedId && (
                           <BackupsPanel instanceId={selectedId} showAlert={showAlert} showConfirm={showConfirm} />
                        )}

                        {editTab === "world" && (
                           <div className="flex flex-col h-full p-10 overflow-auto animate-in fade-in slide-in-from-bottom-4 duration-300">
                              <div className="max-w-2xl mx-auto w-full space-y-10">
                                 <div>
                                    <div className="flex items-center gap-3 mb-2">
                                       <Globe className="w-8 h-8 text-[#3E8ED0]" />
                                       <h3 className="text-2xl font-bold text-white">World Settings</h3>
                                    </div>
                                    <p className="text-neutral-500 text-sm">Configure your world generation and core gameplay settings.
                                       <span className="text-amber-500/80 ml-1 font-medium">Note: Most changes require a server restart.</span></p>
                                 </div>

                                 <div className="grid grid-cols-1 gap-8">
                                    <div className="space-y-3">
                                       <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest pl-1">World Seed</label>
                                       <div className="relative group">
                                          <input
                                             type="text"
                                             value={config.environment["SEED"] || ""}
                                             onChange={(e) => setConfig(prev => ({
                                                ...prev,
                                                environment: { ...prev.environment, SEED: e.target.value }
                                             }))}
                                             placeholder="Random Seed"
                                             className="w-full bg-[#0F0F0F] border border-[#333] p-4 rounded-xl focus:outline-none focus:border-[#3E8ED0] text-sm font-mono text-white transition-all group-hover:border-[#444]"
                                          />
                                       </div>
                                       <p className="text-[10px] text-neutral-600 pl-1 italic">Used for terrain generation. Changing this won't alter already generated terrain.</p>
                                    </div>

                                    <div className="grid grid-cols-2 gap-8">
                                       <div className="space-y-3">
                                          <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest pl-1">Level Type</label>
                                          <select
                                             value={config.environment["LEVEL_TYPE"] || "DEFAULT"}
                                             onChange={(e) => setConfig(prev => ({
                                                ...prev,
                                                environment: { ...prev.environment, LEVEL_TYPE: e.target.value }
                                             }))}
                                             className="w-full bg-[#0F0F0F] border border-[#333] p-4 rounded-xl focus:outline-none focus:border-[#3E8ED0] text-sm text-neutral-300 appearance-none transition-all hover:border-[#444]"
                                          >
                                             <option value="DEFAULT">Default</option>
                                             <option value="FLAT">Flat</option>
                                             <option value="LARGEBIOMES">Large Biomes</option>
                                             <option value="AMPLIFIED">Amplified</option>
                                             <option value="BUFFET">Buffet</option>
                                          </select>
                                       </div>
                                       <div className="space-y-3">
                                          <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest pl-1">Difficulty</label>
                                          <select
                                             value={config.environment["DIFFICULTY"] || "easy"}
                                             onChange={(e) => setConfig(prev => ({
                                                ...prev,
                                                environment: { ...prev.environment, DIFFICULTY: e.target.value }
                                             }))}
                                             className="w-full bg-[#0F0F0F] border border-[#333] p-4 rounded-xl focus:outline-none focus:border-[#3E8ED0] text-sm text-neutral-300 appearance-none transition-all hover:border-[#444]"
                                          >
                                             <option value="peaceful">Peaceful</option>
                                             <option value="easy">Easy</option>
                                             <option value="normal">Normal</option>
                                             <option value="hard">Hard</option>
                                          </select>
                                       </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-8">
                                       <div className="space-y-3">
                                          <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest pl-1">Game Mode</label>
                                          <select
                                             value={config.environment["MODE"] || "survival"}
                                             onChange={(e) => setConfig(prev => ({
                                                ...prev,
                                                environment: { ...prev.environment, MODE: e.target.value }
                                             }))}
                                             className="w-full bg-[#0F0F0F] border border-[#333] p-4 rounded-xl focus:outline-none focus:border-[#3E8ED0] text-sm text-neutral-300 appearance-none transition-all hover:border-[#444]"
                                          >
                                             <option value="survival">Survival</option>
                                             <option value="creative">Creative</option>
                                             <option value="adventure">Adventure</option>
                                             <option value="spectator">Spectator</option>
                                          </select>
                                       </div>
                                       <div className="space-y-3">
                                          <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest pl-1">Structures</label>
                                          <button
                                             onClick={() => setConfig(prev => ({
                                                ...prev,
                                                environment: { ...prev.environment, GENERATE_STRUCTURES: prev.environment["GENERATE_STRUCTURES"] === "false" ? "true" : "false" }
                                             }))}
                                             className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all ${config.environment["GENERATE_STRUCTURES"] !== "false" ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400' : 'bg-red-500/5 border-red-500/20 text-red-400'}`}
                                          >
                                             <span className="text-sm font-bold uppercase tracking-wider">{config.environment["GENERATE_STRUCTURES"] !== "false" ? 'Enabled' : 'Disabled'}</span>
                                             {config.environment["GENERATE_STRUCTURES"] !== "false" ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
                                          </button>
                                       </div>
                                    </div>
                                 </div>

                                 <div className="bg-[#2D2D2D] border border-[#3A3A3A] p-6 rounded-2xl flex gap-5 items-start shadow-xl">
                                    <div className="p-2 bg-amber-500/10 rounded-lg text-amber-500">
                                       <AlertCircle className="w-6 h-6" />
                                    </div>
                                    <div className="space-y-2">
                                       <h4 className="font-bold text-neutral-200">World Management Info</h4>
                                       <p className="text-xs text-neutral-500 leading-relaxed">
                                          Seed and Level Type only take effect during initial world creation. To generate a completely
                                          new world with these settings, you may need to delete the <span className="font-mono text-neutral-400 bg-black/30 px-1 rounded">world</span> folder
                                          in the instance files.
                                       </p>
                                    </div>
                                 </div>
                              </div>
                           </div>
                        )}
                        {editTab === "mods" && (
                           <div className="flex flex-col h-full overflow-hidden bg-[#1E1E1E]">
                              {modListView === "list" ? (
                                 /* PRISM LAUNCHER STYLE MOD CONSOLE VIEW */
                                 <div className="flex flex-col h-full bg-[#1A1A1A] text-neutral-200 select-none">
                                    {/* Hidden file input for "Add File" */}
                                    <input
                                       type="file"
                                       ref={modFileInputRef}
                                       accept=".jar,.zip,.disabled"
                                       onChange={handleModUpload}
                                       className="hidden"
                                    />

                                    {/* Top Header */}
                                    <div className="px-5 py-3 border-b border-[#2C2C2C] bg-[#222222] flex items-center justify-between">
                                       <h3 className="text-base font-bold text-white flex items-center gap-2">
                                          Mods ({instanceMods.length} installed)
                                          {isInstanceModsLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#3E8ED0]" />}
                                       </h3>
                                    </div>

                                    {/* Main Content: Split Table (Left) + Action Sidebar (Right) */}
                                    <div className="flex-1 flex overflow-hidden p-3 gap-3">
                                       {/* Left Panel: Table & Bottom Search */}
                                       <div className="flex-1 flex flex-col min-w-0 bg-[#1E1E1E] border border-[#2D2D2D] rounded">
                                          {/* Table Container */}
                                          <div className="flex-1 overflow-auto scrollbar-custom">
                                             <table className="w-full text-left border-collapse table-fixed">
                                                <thead>
                                                   <tr className="bg-[#262626] border-b border-[#333333] text-[11px] font-bold text-neutral-400 sticky top-0 z-10 select-none">
                                                      <th className="px-2 py-2 w-16 text-center">Enable</th>
                                                      <th className="px-2 py-2 w-14 text-center">Image</th>
                                                      <th className="px-3 py-2">Name</th>
                                                      <th className="px-3 py-2 w-28">Version</th>
                                                      <th className="px-3 py-2 w-36">Last Modified</th>
                                                   </tr>
                                                </thead>
                                                <tbody className="divide-y divide-[#282828]">
                                                   {filteredInstanceMods.length === 0 ? (
                                                      <tr>
                                                         <td colSpan={5} className="py-16 text-center text-neutral-500 italic text-xs">
                                                            {instanceMods.length === 0
                                                               ? 'No mods installed. Click "Download Mods" or "Add File" to install mods.'
                                                               : 'No mods match your search filter.'}
                                                         </td>
                                                      </tr>
                                                   ) : (
                                                      filteredInstanceMods.map((mod) => {
                                                         const isSelected = selectedModFilename === mod.filename;
                                                         const meta = installedModsMeta.find((m: any) => 
                                                            m.id?.toLowerCase() === mod.id?.toLowerCase() || 
                                                            m.requested_id?.toLowerCase() === mod.id?.toLowerCase()
                                                         );
                                                         const cached = modMetaCache[mod.id.toLowerCase()] || modMetaCache[mod.name.toLowerCase()];

                                                         // Resolving icon: mod.icon_url, cached icon, or meta icon
                                                         const displayIcon = mod.icon_url || cached?.icon_url || meta?.icon_url;

                                                         // Resolving clean name: strictly the mod name, NO trailing version and NO filename underneath
                                                         let displayName = meta?.name || cached?.name || mod.name || mod.id;
                                                         displayName = displayName.replace(/\.jar(\.disabled)?$/i, '');
                                                         displayName = displayName.replace(/[-_vV]?\d+(\.\d+)+.*$/, '');
                                                         displayName = displayName.replace(/[-_]\d+.*$/, '').trim();
                                                         if (!displayName) displayName = mod.name || mod.id;
                                                         if (displayName.includes('-') || displayName.includes('_')) {
                                                            displayName = displayName.split(/[-_]/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                                                         }

                                                         // Resolving version
                                                         let displayVersion = mod.version && mod.version !== "-" ? mod.version : (cached?.latest_version || meta?.latest_version || "-");
                                                         if (displayVersion === "-") {
                                                            const vm = mod.filename.replace(/\.jar(\.disabled)?$/i, '').match(/[-_vV](\d+(\.\d+).*)$/);
                                                            if (vm) displayVersion = vm[1];
                                                         }

                                                         return (
                                                            <tr
                                                               key={mod.filename || mod.id}
                                                               onClick={() => setSelectedModFilename(mod.filename)}
                                                               onDoubleClick={() => toggleMod(mod, !mod.enabled)}
                                                               className={`cursor-pointer transition-colors text-xs ${
                                                                  isSelected
                                                                     ? 'bg-[#3E8ED0]/25 text-white'
                                                                     : 'hover:bg-[#252525] text-neutral-300'
                                                               } ${!mod.enabled ? 'opacity-50 text-neutral-500' : ''}`}
                                                            >
                                                               {/* Enable Checkbox */}
                                                               <td className="px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                                                                  <input
                                                                     type="checkbox"
                                                                     checked={mod.enabled}
                                                                     onChange={(e) => toggleMod(mod, e.target.checked)}
                                                                     className="rounded border-[#444] bg-[#181818] accent-[#3E8ED0] w-4 h-4 cursor-pointer"
                                                                  />
                                                               </td>

                                                               {/* Mod Thumbnail Image */}
                                                               <td className="px-2 py-2 text-center">
                                                                  <div className="w-8 h-8 rounded bg-[#2A2A2A] border border-[#383838] overflow-hidden flex items-center justify-center mx-auto shadow-sm">
                                                                     {displayIcon ? (
                                                                        <img src={displayIcon} alt="" className="w-full h-full object-cover" />
                                                                     ) : (
                                                                        <Box className="w-4 h-4 text-neutral-500" />
                                                                     )}
                                                                  </div>
                                                               </td>

                                                               {/* Name (Clean name ONLY) */}
                                                               <td className="px-3 py-2 min-w-0">
                                                                  <div className="flex items-center gap-1.5 min-w-0">
                                                                     <span className={`font-semibold truncate ${isSelected ? 'text-white' : mod.enabled ? 'text-neutral-100' : 'text-neutral-400'}`} title={displayName}>
                                                                        {displayName}
                                                                     </span>
                                                                     {mod.source === "pending" && (
                                                                        <span className="text-[9px] font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 whitespace-nowrap">
                                                                           Pending
                                                                        </span>
                                                                     )}
                                                                  </div>
                                                               </td>

                                                               {/* Version */}
                                                               <td className="px-3 py-2 font-mono text-[11px] truncate text-neutral-400" title={displayVersion}>
                                                                  {displayVersion}
                                                               </td>

                                                               {/* Last Modified */}
                                                               <td className="px-3 py-2 font-mono text-[11px] text-neutral-400 whitespace-nowrap">
                                                                  {mod.source === "pending" ? (
                                                                     <span className="text-amber-400 font-semibold bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20 text-[10px]">
                                                                        Pending Save
                                                                     </span>
                                                                  ) : (
                                                                     mod.modified_str || "-"
                                                                  )}
                                                               </td>
                                                            </tr>
                                                         );
                                                      })
                                                   )}
                                                </tbody>
                                             </table>
                                          </div>

                                          {/* Bottom Search Bar */}
                                          <div className="px-3 py-2 border-t border-[#2D2D2D] bg-[#222222] flex items-center gap-2">
                                             <span className="text-xs font-semibold text-neutral-400">Search</span>
                                             <div className="relative flex-1 max-w-sm">
                                                <input
                                                   type="text"
                                                   value={modFilterQuery}
                                                   onChange={(e) => setModFilterQuery(e.target.value)}
                                                   placeholder=""
                                                   className="w-full bg-[#161616] border border-[#333] px-2.5 py-1 rounded text-xs text-neutral-200 focus:outline-none focus:border-[#3E8ED0]"
                                                />
                                                {modFilterQuery && (
                                                   <button
                                                      onClick={() => setModFilterQuery("")}
                                                      className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white text-xs font-bold"
                                                   >
                                                      ×
                                                   </button>
                                                )}
                                             </div>
                                          </div>
                                       </div>

                                       {/* Right Panel: Prism Launcher Action Sidebar */}
                                       <div className="w-44 flex flex-col gap-1.5 flex-shrink-0 select-none">
                                          <button
                                             onClick={() => setModListView("search")}
                                             className="w-full text-left px-3 py-1.5 rounded text-xs font-medium bg-[#2A2A2A] hover:bg-[#343434] text-neutral-200 border border-[#383838] transition-colors"
                                          >
                                             Download Mods
                                          </button>

                                          <button
                                             onClick={handleCheckUpdatesAndSyncMods}
                                             className="w-full text-left px-3 py-1.5 rounded text-xs font-medium bg-[#2A2A2A] hover:bg-[#343434] text-neutral-200 border border-[#383838] transition-colors flex items-center justify-between"
                                          >
                                             <span>Check for Updates</span>
                                             {isInstanceModsLoading && <RefreshCw className="w-3 h-3 animate-spin text-[#3E8ED0]" />}
                                          </button>

                                          <button
                                             disabled
                                             className="w-full text-left px-3 py-1.5 rounded text-xs font-medium text-neutral-600 bg-[#222222] border border-[#2A2A2A] cursor-not-allowed"
                                          >
                                             Change Version
                                          </button>

                                          <button
                                             onClick={() => modFileInputRef.current?.click()}
                                             className="w-full text-left px-3 py-1.5 rounded text-xs font-medium bg-[#2A2A2A] hover:bg-[#343434] text-neutral-200 border border-[#383838] transition-colors"
                                          >
                                             Add File
                                          </button>

                                          <div className="h-px bg-[#303030] my-1" />

                                          <button
                                             disabled={!selectedMod}
                                             onClick={() => selectedMod && deleteMod(selectedMod)}
                                             className={`w-full text-left px-3 py-1.5 rounded text-xs font-medium transition-colors ${selectedMod
                                                   ? 'bg-[#2A2A2A] hover:bg-red-950/40 text-neutral-200 hover:text-red-400 border border-[#383838] hover:border-red-900/50'
                                                   : 'text-neutral-600 bg-[#222222] border border-[#2A2A2A] cursor-not-allowed'
                                                }`}
                                          >
                                             Remove
                                          </button>

                                          <button
                                             disabled={!selectedMod || selectedMod.enabled}
                                             onClick={() => selectedMod && toggleMod(selectedMod, true)}
                                             className={`w-full text-left px-3 py-1.5 rounded text-xs font-medium transition-colors ${selectedMod && !selectedMod.enabled
                                                   ? 'bg-[#2A2A2A] hover:bg-[#343434] text-neutral-200 border border-[#383838]'
                                                   : 'text-neutral-600 bg-[#222222] border border-[#2A2A2A] cursor-not-allowed'
                                                }`}
                                          >
                                             Enable
                                          </button>

                                          <button
                                             disabled={!selectedMod || !selectedMod.enabled}
                                             onClick={() => selectedMod && toggleMod(selectedMod, false)}
                                             className={`w-full text-left px-3 py-1.5 rounded text-xs font-medium transition-colors ${selectedMod && selectedMod.enabled
                                                   ? 'bg-[#2A2A2A] hover:bg-[#343434] text-neutral-200 border border-[#383838]'
                                                   : 'text-neutral-600 bg-[#222222] border border-[#2A2A2A] cursor-not-allowed'
                                                }`}
                                          >
                                             Disable
                                          </button>

                                          <div className="h-px bg-[#303030] my-1" />

                                          <button
                                             disabled={!selectedMod || (!selectedMod.url && !selectedMod.id)}
                                             onClick={() => {
                                                if (!selectedMod) return;
                                                const url = selectedMod.url || (selectedMod.id ? `https://modrinth.com/mod/${selectedMod.id}` : null);
                                                if (url) window.open(url, '_blank');
                                             }}
                                             className={`w-full text-left px-3 py-1.5 rounded text-xs font-medium transition-colors ${selectedMod && (selectedMod.url || selectedMod.id)
                                                   ? 'bg-[#2A2A2A] hover:bg-[#343434] text-neutral-200 border border-[#383838]'
                                                   : 'text-neutral-600 bg-[#222222] border border-[#2A2A2A] cursor-not-allowed'
                                                }`}
                                          >
                                             View Homepage
                                          </button>

                                          <button
                                             onClick={exportModsList}
                                             className="w-full text-left px-3 py-1.5 rounded text-xs font-medium bg-[#2A2A2A] hover:bg-[#343434] text-neutral-200 border border-[#383838] transition-colors"
                                          >
                                             Export List
                                          </button>

                                          <div className="h-px bg-[#303030] my-1" />

                                          <button
                                             onClick={() => {
                                                setEditTab("files");
                                                fetchFileList(selectedId, "data/mods");
                                             }}
                                             className="w-full text-left px-3 py-1.5 rounded text-xs font-medium bg-[#2A2A2A] hover:bg-[#343434] text-neutral-200 border border-[#383838] transition-colors"
                                          >
                                             View Folder
                                          </button>

                                          <button
                                             onClick={() => {
                                                setEditTab("files");
                                                fetchFileList(selectedId, "data/config");
                                             }}
                                             className="w-full text-left px-3 py-1.5 rounded text-xs font-medium bg-[#2A2A2A] hover:bg-[#343434] text-neutral-200 border border-[#383838] transition-colors"
                                          >
                                             View Configs
                                          </button>
                                       </div>
                                    </div>
                                 </div>
                              ) : (
                                 /* SEARCH / DOWNLOAD VIEW */
                                 <div className="flex flex-col h-full overflow-hidden">
                                    <div className="p-4 border-b border-[#323232] bg-[#242424] flex items-center gap-4 shadow-sm">
                                       <button
                                          onClick={() => setModListView("list")}
                                          className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-[#333] text-neutral-300 hover:text-white rounded border border-[#383838] transition-colors text-xs font-semibold"
                                       >
                                          <ArrowLeft className="w-4 h-4" /> Back to Mods
                                       </button>
                                       <h3 className="text-xl font-bold flex items-center gap-2">
                                          Mod Search (Modrinth)
                                          {isModSearching && <RefreshCw className="w-4 h-4 animate-spin text-[#3E8ED0]" />}
                                       </h3>
                                    </div>

                                    <div className="p-6 bg-[#242424] border-b border-[#323232] flex flex-col gap-4">
                                       <div className="flex items-center gap-3">
                                          <div className="flex-1 relative group">
                                             <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 group-focus-within:text-[#3E8ED0] transition-colors" />
                                             <input
                                                type="text"
                                                className="w-full bg-[#1A1A1A] border border-[#3A3A3A] pl-10 pr-4 py-2 rounded focus:outline-none focus:border-[#3E8ED0] text-sm transition-all"
                                                placeholder="Search for mods..."
                                                value={modSearchQuery}
                                                onChange={(e) => setModSearchQuery(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && handleModSearch(modSearchQuery, modSearchProvider)}
                                             />
                                          </div>

                                          <select
                                             className="bg-[#1A1A1A] border border-[#3A3A3A] px-3 py-2 rounded text-xs focus:outline-none focus:border-[#3E8ED0]"
                                             value={modSearchVersion}
                                             onChange={(e) => {
                                                setModSearchVersion(e.target.value);
                                                handleModSearch(modSearchQuery, modSearchProvider, e.target.value, modSearchLoader);
                                             }}
                                          >
                                             <option value="">Any Version</option>
                                             {mcVersions.filter((v: any) => v.type === "release").slice(0, 150).map((v: any) => (
                                                <option key={v.id} value={v.id}>{v.id}</option>
                                             ))}
                                          </select>

                                          <select
                                             className="bg-[#1A1A1A] border border-[#3A3A3A] px-3 py-2 rounded text-xs focus:outline-none focus:border-[#3E8ED0]"
                                             value={modSearchLoader}
                                             onChange={(e) => {
                                                setModSearchLoader(e.target.value);
                                                handleModSearch(modSearchQuery, modSearchProvider, modSearchVersion, e.target.value);
                                             }}
                                          >
                                             <option value="">Any Loader</option>
                                             <option value="VANILLA">Vanilla</option>
                                             <option value="FABRIC">Fabric</option>
                                             <option value="FORGE">Forge</option>
                                             <option value="QUILT">Quilt</option>
                                             <option value="NEOFORGE">NeoForge</option>
                                          </select>

                                          <button
                                             onClick={() => handleModSearch(modSearchQuery, modSearchProvider)}
                                             className="px-6 py-2 bg-[#3E8ED0] hover:bg-[#2B6A9E] text-white rounded font-bold text-sm shadow-sm transition-all whitespace-nowrap"
                                          >
                                             Search
                                          </button>
                                       </div>
                                    </div>

                                    <div className="flex-1 overflow-auto p-4 bg-[#1E1E1E]">
                                       <div className="grid grid-cols-1 gap-2">
                                          {modSearchResults.length === 0 ? (
                                             <div className="flex flex-col items-center justify-center p-12 text-neutral-600 opacity-50">
                                                <Search className="w-12 h-12 mb-3" />
                                                <p className="text-sm font-medium text-center">{modSearchQuery ? "No mods found matching your query and filters." : "Search for something above!"}</p>
                                             </div>
                                          ) : (
                                             modSearchResults.map((res) => {
                                                const envKey = "MODRINTH_PROJECTS";
                                                const currentList: string = config.environment[envKey] || "";
                                                const isAdded = currentList.split(',').map(s => s.trim().toLowerCase()).includes(res.id.toLowerCase()) || instanceMods.some(m => m.id.toLowerCase() === res.id.toLowerCase());

                                                return (
                                                   <div key={res.id} className="flex gap-4 p-3 rounded-lg border border-[#333] bg-[#222] hover:bg-[#282828] transition-colors group">
                                                      <div className="w-12 h-12 bg-[#333] rounded overflow-hidden flex-shrink-0 shadow-inner">
                                                         {res.icon_url ? <img src={res.icon_url} alt="" className="w-full h-full object-cover" /> : <Box className="w-full h-full p-2 text-neutral-600" />}
                                                      </div>
                                                      <div className="flex-1 min-w-0">
                                                         <div className="flex items-center justify-between mb-0.5">
                                                            <h5 className="font-bold text-[#E0E0E0] truncate text-sm">{res.name}</h5>
                                                            <a href={res.url} target="_blank" className="text-neutral-500 hover:text-white group-hover:block hidden"><ExternalLink className="w-3 h-3" /></a>
                                                         </div>
                                                         <p className="text-[11px] text-neutral-400 line-clamp-2 leading-relaxed mb-2">{res.summary}</p>
                                                         <div className="flex items-center justify-between">
                                                            <div className="flex flex-col gap-1">
                                                               <span className="text-[10px] text-neutral-500 font-mono">By {res.author} • {res.downloads.toLocaleString()} downloads</span>
                                                               {/* Conflict/Warning display */}
                                                               {(() => {
                                                                  const instanceLoader = getInstanceModLoader(config.environment);
                                                                  const modCats = res.categories || [];
                                                                  const hasFabric = modCats.includes("fabric");
                                                                  const hasForge = modCats.includes("forge") || modCats.includes("neoforge");

                                                                  if (instanceLoader === "FABRIC" && hasForge && !hasFabric) {
                                                                     return <div className="text-[9px] text-red-400 font-bold flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Potential Forge-only mod</div>;
                                                                  }
                                                                  if ((instanceLoader === "FORGE" || instanceLoader === "NEOFORGE") && hasFabric && !hasForge) {
                                                                     return <div className="text-[9px] text-red-400 font-bold flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Potential Fabric-only mod</div>;
                                                                  }
                                                                  return null;
                                                               })()}
                                                            </div>
                                                            {isAdded ? (
                                                               <div className="flex items-center gap-1 text-emerald-400 text-[10px] font-bold bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20">
                                                                  <Check className="w-3 h-3" /> Added
                                                               </div>
                                                            ) : (
                                                               <div className="flex gap-2">
                                                                  <button
                                                                     onClick={() => handleAddMod(res, modSearchProvider)}
                                                                     className="flex items-center gap-1.5 px-3 py-1 bg-[#222] hover:bg-[#333] text-neutral-400 hover:text-white rounded border border-[#333] transition-all text-[11px] font-bold"
                                                                  >
                                                                     <Plus className="w-3 h-3" /> Add
                                                                  </button>
                                                                  <button
                                                                     onClick={() => addWithDependencies(res, modSearchProvider)}
                                                                     className="flex items-center gap-1.5 px-3 py-1 bg-[#3E8ED0]/10 hover:bg-[#3E8ED0] text-[#3E8ED0] hover:text-white rounded border border-[#3E8ED0]/30 transition-all text-[11px] font-bold"
                                                                  >
                                                                     <RefreshCw className="w-3 h-3" /> Add with Deps
                                                                  </button>
                                                               </div>
                                                            )}
                                                         </div>
                                                      </div>
                                                   </div>
                                                );
                                             })
                                          )}
                                       </div>
                                    </div>
                                 </div>
                              )}
                           </div>
                        )}
                        {editTab === "resource-pack" && (
                           <div className="flex flex-col h-full overflow-hidden bg-[#1E1E1E]">
                              {resourcePackListView === "list" ? (
                                 /* INSTALLED RESOURCE PACKS LIST VIEW */
                                 <div className="flex flex-col h-full">
                                    <div className="p-4 border-b border-[#323232] bg-[#242424] flex items-center justify-between">
                                       <h3 className="text-lg font-bold flex items-center gap-2">
                                          Resource Packs ({installedResourcePacksMeta.length} selected)
                                       </h3>
                                       <div className="flex gap-2">
                                          <button
                                             onClick={() => setResourcePackListView("search")}
                                             className="flex items-center gap-2 bg-[#3E8ED0] hover:bg-[#2B6A9E] text-white px-4 py-1.5 rounded text-sm font-bold transition-all"
                                          >
                                             <Plus className="w-4 h-4" /> Add Packs
                                          </button>
                                          <button
                                             onClick={fetchInstalledResourcePacksMeta}
                                             className="flex items-center gap-2 bg-[#333] hover:bg-[#444] text-white px-3 py-1.5 rounded text-sm font-bold transition-all"
                                          >
                                             <RefreshCw className={`w-4 h-4 ${isResourcePackMetaLoading ? 'animate-spin' : ''}`} /> Refresh
                                          </button>
                                       </div>
                                    </div>

                                    <div className="flex-1 overflow-x-auto p-4">
                                       <div className="bg-[#242424] border border-[#323232] rounded-lg overflow-x-auto scrollbar-custom">
                                          <table className="w-full text-left border-collapse min-w-[700px]">
                                             <thead>
                                                <tr className="bg-[#2D2D2D] border-b border-[#323232] text-[11px] font-bold text-neutral-500 uppercase tracking-widest">
                                                   <th className="px-4 py-2 w-16">Image</th>
                                                   <th className="px-4 py-2">Name</th>
                                                   <th className="px-4 py-2">Provider</th>
                                                   <th className="px-4 py-2 text-right">Actions</th>
                                                </tr>
                                             </thead>
                                             <tbody className="divide-y divide-[#323232]">
                                                {installedResourcePacksMeta.length === 0 ? (
                                                   <tr>
                                                      <td colSpan={5} className="p-12 text-center text-neutral-600 italic text-sm">
                                                         No resource packs selected. Click "Add Packs" to search!
                                                      </td>
                                                   </tr>
                                                ) : (
                                                   installedResourcePacksMeta.map((pack) => {
                                                      return (
                                                         <tr key={pack.id} className="hover:bg-[#2A2A2A] transition-colors group">
                                                            <td className="px-4 py-3">
                                                               <div className="w-10 h-10 bg-[#333] rounded overflow-hidden shadow-inner flex items-center justify-center">
                                                                  {pack.icon_url ? <img src={pack.icon_url} className="w-full h-full object-cover" /> : <Layers className="w-5 h-5 text-neutral-600" />}
                                                               </div>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                               <div className="flex flex-col">
                                                                  <span className="font-bold text-sm text-[#E0E0E0]">{pack.name}</span>
                                                                  <span className="text-[10px] text-neutral-500 truncate max-w-md">{pack.summary || "No description available"}</span>
                                                               </div>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                               <span className="text-[10px] font-bold bg-[#333] px-2 py-0.5 rounded text-neutral-400 capitalize">{pack.provider}</span>
                                                            </td>
                                                            <td className="px-4 py-3 text-right">
                                                               <div className="flex justify-end gap-2 items-center">
                                                                  <a href={pack.url} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:text-white text-neutral-500"><ExternalLink className="w-4 h-4" /></a>
                                                                  <button
                                                                     onClick={() => {
                                                                        const envKey = pack.provider === 'modrinth' ? 'RESOURCE_PACKS_MODRINTH' : 'RESOURCE_PACKS_CF';
                                                                        const current = (config.environment[envKey] || "").split(',').map(s => s.trim()).filter(Boolean);
                                                                        const newList = current.filter(x => x !== pack.id && x !== pack.requested_id).join(',');
                                                                        setConfig(prev => ({
                                                                           ...prev,
                                                                           environment: { ...prev.environment, [envKey]: newList }
                                                                        }));
                                                                        setTimeout(fetchInstalledResourcePacksMeta, 100);
                                                                     }}
                                                                     className="p-1.5 hover:text-red-400 text-neutral-500"
                                                                  >
                                                                     <Trash2 className="w-4 h-4" />
                                                                  </button>
                                                               </div>
                                                            </td>
                                                         </tr>
                                                      );
                                                   })
                                                )}
                                             </tbody>
                                          </table>
                                       </div>
                                    </div>

                                    <div className="p-6 bg-[#242424] border-t border-[#323232] flex items-center justify-between">
                                       <div className="flex flex-col gap-1">
                                          <div className="flex items-center gap-2">
                                             <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest pl-1">Requirement Policy</span>
                                             <div className="flex bg-[#141414] rounded-md p-1 border border-[#333] h-[32px]">
                                                <button
                                                   onClick={() => setConfig(prev => ({
                                                      ...prev,
                                                      environment: {
                                                         ...prev.environment,
                                                         RESOURCE_PACK_ENFORCE: "FALSE",
                                                         REQUIRE_RESOURCE_PACK: "FALSE"
                                                      }
                                                   }))}
                                                   className={`px-3 rounded text-[9px] font-bold transition-all ${String(config.environment["RESOURCE_PACK_ENFORCE"]).toUpperCase() !== "TRUE" && String(config.environment["REQUIRE_RESOURCE_PACK"]).toUpperCase() !== "TRUE" ? 'bg-[#333] text-white shadow-inner' : 'text-neutral-500 hover:text-neutral-300'}`}
                                                >
                                                   SUGGESTED
                                                </button>
                                                <button
                                                   onClick={() => setConfig(prev => {
                                                      const { RESOURCE_PACK_ID: _, ...rest } = prev.environment;
                                                      const newEnv: Record<string, string> = {
                                                         ...rest,
                                                         RESOURCE_PACK_ENFORCE: "TRUE",
                                                         REQUIRE_RESOURCE_PACK: "TRUE"
                                                      };

                                                      // Automatic JSON-wrapping if missing
                                                      if (newEnv["RESOURCE_PACK_PROMPT"] && !newEnv["RESOURCE_PACK_PROMPT"].trim().startsWith('{')) {
                                                         newEnv["RESOURCE_PACK_PROMPT"] = JSON.stringify({ text: newEnv["RESOURCE_PACK_PROMPT"] });
                                                      }

                                                      return { ...prev, environment: newEnv };
                                                   })}
                                                   className={`px-3 rounded text-[9px] font-bold transition-all ${String(config.environment["RESOURCE_PACK_ENFORCE"]).toUpperCase() === "TRUE" || String(config.environment["REQUIRE_RESOURCE_PACK"]).toUpperCase() === "TRUE" ? 'bg-amber-600/20 text-amber-500 border border-amber-600/30 shadow-inner' : 'text-neutral-500 hover:text-neutral-300'}`}
                                                >
                                                   REQUIRED
                                                </button>
                                             </div>
                                          </div>
                                          <span className="text-[10px] text-neutral-600 italic">All selected packs will be automatically bundled and served to players via MCPacks.</span>
                                       </div>
                                       <div className="flex flex-col gap-2 min-w-[300px]">
                                          <label className="text-[9px] font-bold text-neutral-500 uppercase tracking-widest px-1">Bundle Install Message</label>
                                          <input
                                             type="text"
                                             value={config.environment["RESOURCE_PACK_PROMPT"] || ""}
                                             onChange={(e) => setConfig(prev => ({ ...prev, environment: { ...prev.environment, RESOURCE_PACK_PROMPT: e.target.value } }))}
                                             className="bg-[#141414] border border-[#3A3A3A] px-3 py-1.5 rounded text-xs text-neutral-400 focus:outline-none focus:border-[#3E8ED0]"
                                             placeholder="Message shown when players join"
                                          />
                                       </div>
                                    </div>
                                 </div>
                              ) : (
                                 /* SEARCH / DOWNLOAD VIEW */
                                 <div className="flex flex-col h-full overflow-hidden">
                                    <div className="p-4 border-b border-[#323232] bg-[#242424] flex items-center gap-4 shadow-sm">
                                       <button
                                          onClick={() => setResourcePackListView("list")}
                                          className="p-2 hover:bg-[#333] rounded-full transition-colors text-neutral-400 hover:text-white"
                                       >
                                          <X className="w-5 h-5" />
                                       </button>
                                       <h3 className="text-xl font-bold flex items-center gap-2">
                                          Search Resource Packs (Modrinth)
                                          {isResourcePackSearching && <RefreshCw className="w-4 h-4 animate-spin text-[#3E8ED0]" />}
                                       </h3>
                                    </div>

                                    <div className="p-6 bg-[#242424] border-b border-[#323232] flex flex-col gap-4">
                                       <div className="flex items-center gap-3">
                                          <div className="flex-1 relative group">
                                             <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 group-focus-within:text-[#3E8ED0] transition-colors" />
                                             <input
                                                type="text"
                                                className="w-full bg-[#1A1A1A] border border-[#3A3A3A] pl-10 pr-4 py-2 rounded focus:outline-none focus:border-[#3E8ED0] text-sm transition-all"
                                                placeholder="Search for textures, packs, assets..."
                                                value={resourcePackQuery}
                                                onChange={(e) => setResourcePackQuery(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && handleResourcePackSearch(resourcePackQuery, resourcePackProvider)}
                                             />
                                          </div>

                                          <button
                                             onClick={() => handleResourcePackSearch(resourcePackQuery, resourcePackProvider)}
                                             className="px-6 py-2 bg-[#3E8ED0] hover:bg-[#2B6A9E] text-white rounded font-bold text-sm shadow-sm transition-all whitespace-nowrap"
                                          >
                                             Search
                                          </button>
                                       </div>
                                    </div>

                                    <div className="flex-1 overflow-auto p-4 bg-[#1E1E1E]">
                                       <div className="grid grid-cols-1 gap-2">
                                          {resourcePackResults.length === 0 ? (
                                             <div className="flex flex-col items-center justify-center p-12 text-neutral-600 opacity-50">
                                                <Search className="w-12 h-12 mb-3" />
                                                <p className="text-sm font-medium text-center">{resourcePackQuery ? "No packs found matching your query." : "Search for a pack above!"}</p>
                                             </div>
                                          ) : (
                                             resourcePackResults.map((res) => {
                                                const envKey = "RESOURCE_PACKS_MODRINTH";
                                                const currentList: string = config.environment[envKey] || "";
                                                const isAdded = currentList.split(',').map(s => s.trim()).includes(res.id);

                                                return (
                                                   <div key={res.id} className="flex gap-4 p-3 rounded-lg border border-[#333] bg-[#222] hover:bg-[#282828] transition-colors group">
                                                      <div className="w-12 h-12 bg-[#333] rounded overflow-hidden flex-shrink-0 shadow-inner">
                                                         {res.icon_url ? <img src={res.icon_url} alt="" className="w-full h-full object-cover" /> : <Layers className="w-full h-full p-2 text-neutral-600" />}
                                                      </div>
                                                      <div className="flex-1 min-w-0">
                                                         <div className="flex items-center justify-between mb-0.5">
                                                            <h5 className="font-bold text-[#E0E0E0] truncate text-sm">{res.name}</h5>
                                                            <a href={res.url} target="_blank" rel="noopener noreferrer" className="text-neutral-500 hover:text-white group-hover:block hidden"><ExternalLink className="w-3 h-3" /></a>
                                                         </div>
                                                         <p className="text-[11px] text-neutral-400 line-clamp-1 leading-relaxed mb-1">{res.summary}</p>
                                                         <div className="flex items-center justify-between">
                                                            <span className="text-[10px] text-neutral-500 font-mono">By {res.author} • {res.downloads.toLocaleString()} dl</span>
                                                            {isAdded ? (
                                                               <div className="flex items-center gap-1 text-emerald-400 text-[10px] font-bold bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20 shadow-sm">
                                                                  <Check className="w-3 h-3" /> Added
                                                               </div>
                                                            ) : (
                                                               <button
                                                                  onClick={() => {
                                                                     const currentList: string = config.environment[envKey] || "";
                                                                     const currentItems = currentList.split(',').map(s => s.trim()).filter(Boolean);
                                                                     const newListSet = new Set([...currentItems, res.id]);
                                                                     setConfig(prev => ({
                                                                        ...prev,
                                                                        environment: { ...prev.environment, [envKey]: Array.from(newListSet).join(',') }
                                                                     }));
                                                                     setTimeout(fetchInstalledResourcePacksMeta, 100);
                                                                  }}
                                                                  className="flex items-center gap-1.5 px-4 py-1 bg-[#3E8ED0] hover:bg-[#2B6A9E] text-white rounded transition-all text-xs font-bold shadow-md"
                                                               >
                                                                  <Plus className="w-3.5 h-3.5" /> Add
                                                               </button>
                                                            )}
                                                         </div>
                                                      </div>
                                                   </div>
                                                );
                                             })
                                          )}
                                       </div>
                                    </div>
                                 </div>
                              )}
                           </div>
                        )}
                        {editTab === "files" && (
                           <div
                              className="flex flex-col h-full bg-[#1A1A1A] p-6 overflow-hidden relative select-none"
                              onContextMenu={(e) => {
                                 e.preventDefault();
                                 setFileContextMenu({ x: e.clientX, y: e.clientY, target: null });
                              }}
                              onDragOver={(e) => {
                                 e.preventDefault();
                                 if (e.dataTransfer.types.includes("Files")) {
                                    setIsExternalDragOver(true);
                                 }
                              }}
                              onDragLeave={(e) => {
                                 if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                    setIsExternalDragOver(false);
                                    setDragTargetFolder(null);
                                 }
                              }}
                              onDrop={(e) => {
                                 e.preventDefault();
                                 setIsExternalDragOver(false);
                                 setDragTargetFolder(null);
                                 if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                                    handleUploadFileList(e.dataTransfer.files, currentFilePath);
                                 }
                              }}
                           >
                              {/* External Drag Overlay */}
                              {isExternalDragOver && (
                                 <div className="absolute inset-0 z-40 bg-[#3E8ED0]/20 border-2 border-dashed border-[#3E8ED0] rounded-xl flex flex-col items-center justify-center backdrop-blur-sm pointer-events-none animate-in fade-in duration-150">
                                    <Upload className="w-12 h-12 text-[#3E8ED0] animate-bounce mb-2" />
                                    <span className="text-lg font-bold text-white">Drop files to upload here</span>
                                    <span className="text-xs text-neutral-300 mt-1">Uploading to: {currentFilePath === "." ? "root" : currentFilePath}</span>
                                 </div>
                              )}

                              {/* Hidden File Input */}
                              <input
                                 type="file"
                                 multiple
                                 ref={fileUploadInputRef}
                                 className="hidden"
                                 onChange={(e) => {
                                    if (e.target.files && e.target.files.length > 0) {
                                       handleUploadFileList(e.target.files, currentFilePath);
                                       e.target.value = "";
                                    }
                                 }}
                              />

                              {/* Header & Breadcrumbs & Action Toolbar */}
                              <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
                                 <div className="flex flex-col">
                                    <h3 className="text-xl font-bold flex items-center gap-2 text-white">
                                       <Folder className="w-6 h-6 text-yellow-500" /> {isGlobalBrowser ? "Global Folders" : "Files"}
                                    </h3>
                                    {/* Breadcrumbs with Drop Targets */}
                                    <div className="flex items-center gap-1 text-xs text-neutral-400 mt-1 flex-wrap">
                                       <span
                                          onClick={() => fetchFileList(isGlobalBrowser ? null : selectedId, ".")}
                                          onDragOver={(e) => {
                                             e.preventDefault();
                                             e.stopPropagation();
                                             setDragTargetFolder(".");
                                          }}
                                          onDragLeave={() => {
                                             if (dragTargetFolder === ".") setDragTargetFolder(null);
                                          }}
                                          onDrop={(e) => {
                                             e.preventDefault();
                                             e.stopPropagation();
                                             setDragTargetFolder(null);
                                             if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                                                handleUploadFileList(e.dataTransfer.files, ".");
                                             } else if (draggedFileNames && draggedFileNames.length > 0) {
                                                const sourcePaths = draggedFileNames.map(f => currentFilePath === "." ? f : `${currentFilePath}/${f}`);
                                                handleExecuteMoveOrCopy("cut", sourcePaths, ".", "fail");
                                                setDraggedFileNames(null);
                                             }
                                          }}
                                          className={`px-1.5 py-0.5 rounded cursor-pointer transition ${dragTargetFolder === "." ? 'bg-[#3E8ED0] text-white font-bold ring-2 ring-[#3E8ED0]' : 'hover:bg-[#333] hover:text-white'}`}
                                       >
                                          {isGlobalBrowser ? "isopod" : "root"}
                                       </span>
                                       {currentFilePath !== "." && currentFilePath.split('/').map((seg, i, arr) => {
                                          const segPath = arr.slice(0, i + 1).join('/');
                                          const isLast = i === arr.length - 1;
                                          return (
                                             <React.Fragment key={i}>
                                                <ChevronRight className="w-3.5 h-3.5 text-neutral-600" />
                                                <span
                                                   onClick={() => !isLast && fetchFileList(isGlobalBrowser ? null : selectedId, segPath)}
                                                   onDragOver={(e) => {
                                                      e.preventDefault();
                                                      e.stopPropagation();
                                                      setDragTargetFolder(segPath);
                                                   }}
                                                   onDragLeave={() => {
                                                      if (dragTargetFolder === segPath) setDragTargetFolder(null);
                                                   }}
                                                   onDrop={(e) => {
                                                      e.preventDefault();
                                                      e.stopPropagation();
                                                      setDragTargetFolder(null);
                                                      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                                                         handleUploadFileList(e.dataTransfer.files, segPath);
                                                      } else if (draggedFileNames && draggedFileNames.length > 0) {
                                                         const sourcePaths = draggedFileNames.map(f => currentFilePath === "." ? f : `${currentFilePath}/${f}`);
                                                         handleExecuteMoveOrCopy("cut", sourcePaths, segPath, "fail");
                                                         setDraggedFileNames(null);
                                                      }
                                                   }}
                                                   className={`px-1.5 py-0.5 rounded transition ${isLast ? 'text-neutral-200 font-semibold cursor-default' : 'cursor-pointer hover:bg-[#333] hover:text-white'} ${dragTargetFolder === segPath ? 'bg-[#3E8ED0] text-white font-bold ring-2 ring-[#3E8ED0]' : ''}`}
                                                >
                                                   {seg}
                                                </span>
                                             </React.Fragment>
                                          );
                                       })}
                                    </div>
                                 </div>

                                 {/* Toolbar Actions */}
                                 <div className="flex items-center gap-1.5 flex-wrap">
                                    {currentFilePath !== "." && (
                                       <button
                                          onClick={() => {
                                             const parts = currentFilePath.split('/');
                                             parts.pop();
                                             const instanceId = isGlobalBrowser ? null : selectedId;
                                             fetchFileList(instanceId, parts.join('/') || ".");
                                          }}
                                          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#2A2A2A] hover:bg-[#383838] border border-[#3A3A3A] rounded text-xs text-neutral-300 transition"
                                          title="Go to parent directory"
                                       >
                                          <ArrowLeft className="w-3.5 h-3.5" /> Back
                                       </button>
                                    )}

                                    <button
                                       onClick={() => setInlineEditing({ type: "new_file", value: "" })}
                                       className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#2A2A2A] hover:bg-[#383838] border border-[#3A3A3A] rounded text-xs text-neutral-300 hover:text-white transition"
                                       title="New File"
                                    >
                                       <FilePlus className="w-3.5 h-3.5 text-[#3E8ED0]" /> New File
                                    </button>

                                    <button
                                       onClick={() => setInlineEditing({ type: "new_folder", value: "" })}
                                       className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#2A2A2A] hover:bg-[#383838] border border-[#3A3A3A] rounded text-xs text-neutral-300 hover:text-white transition"
                                       title="New Folder"
                                    >
                                       <FolderPlus className="w-3.5 h-3.5 text-yellow-500" /> New Folder
                                    </button>

                                    <button
                                       onClick={() => fileUploadInputRef.current?.click()}
                                       className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#2A2A2A] hover:bg-[#383838] border border-[#3A3A3A] rounded text-xs text-neutral-300 hover:text-white transition"
                                       title="Upload Files from OS"
                                    >
                                       <Upload className="w-3.5 h-3.5 text-green-400" /> Upload
                                    </button>

                                    {fileClipboard && (
                                       <button
                                          onClick={handlePasteClipboard}
                                          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#3E8ED0]/20 hover:bg-[#3E8ED0]/30 border border-[#3E8ED0]/50 rounded text-xs text-[#3E8ED0] font-semibold transition"
                                          title={`Paste ${fileClipboard.files.length} items (${fileClipboard.action})`}
                                       >
                                          <Clipboard className="w-3.5 h-3.5" /> Paste ({fileClipboard.files.length})
                                       </button>
                                    )}

                                    {selectedFileNames.length > 0 && (
                                       <>
                                          <button
                                             onClick={() => handleDownloadFilesOrFolders(selectedFileNames)}
                                             className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#2A2A2A] hover:bg-[#383838] border border-[#3A3A3A] rounded text-xs text-neutral-300 hover:text-white transition"
                                             title="Download selected items"
                                          >
                                             <Download className="w-3.5 h-3.5 text-blue-400" /> Download ({selectedFileNames.length})
                                          </button>
                                          <button
                                             onClick={() => {
                                                setFileClipboard({
                                                   action: "cut",
                                                   files: [...selectedFileNames],
                                                   sourceDir: currentFilePath,
                                                   instanceId: isGlobalBrowser ? null : selectedId
                                                });
                                             }}
                                             className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#2A2A2A] hover:bg-[#383838] border border-[#3A3A3A] rounded text-xs text-neutral-300 hover:text-white transition"
                                             title="Cut selected items"
                                          >
                                             <Scissors className="w-3.5 h-3.5" /> Cut
                                          </button>
                                          <button
                                             onClick={() => {
                                                setFileClipboard({
                                                   action: "copy",
                                                   files: [...selectedFileNames],
                                                   sourceDir: currentFilePath,
                                                   instanceId: isGlobalBrowser ? null : selectedId
                                                });
                                             }}
                                             className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#2A2A2A] hover:bg-[#383838] border border-[#3A3A3A] rounded text-xs text-neutral-300 hover:text-white transition"
                                             title="Copy selected items"
                                          >
                                             <Copy className="w-3.5 h-3.5" /> Copy
                                          </button>
                                          <button
                                             onClick={() => handleDeleteFilesOrFolders(selectedFileNames)}
                                             className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-950/40 hover:bg-red-900/60 border border-red-800/60 rounded text-xs text-red-300 font-medium transition"
                                             title="Delete selected items"
                                          >
                                             <Trash2 className="w-3.5 h-3.5" /> Delete ({selectedFileNames.length})
                                          </button>
                                       </>
                                    )}

                                    <button
                                       onClick={() => fetchFileList(isGlobalBrowser ? null : selectedId, currentFilePath)}
                                       className="flex items-center justify-center p-2 bg-[#2A2A2A] hover:bg-[#383838] border border-[#3A3A3A] rounded text-neutral-300 transition"
                                       title="Refresh file list"
                                    >
                                       <RefreshCw className={`w-3.5 h-3.5 ${isFilesLoading ? 'animate-spin' : ''}`} />
                                    </button>
                                 </div>
                              </div>

                              {/* File Viewer or Table */}
                              {viewingFile ? (
                                 <div className="flex flex-col flex-1 bg-[#0D0D0D] border border-[#333] rounded-lg overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
                                    <div className="px-4 py-2.5 bg-[#1F1F1F] border-b border-[#333] flex justify-between items-center">
                                       <div className="flex items-center gap-2">
                                          <FileText className="w-4 h-4 text-[#3E8ED0]" />
                                          <span className="text-sm font-bold text-neutral-300">{viewingFile.name}</span>
                                       </div>
                                       <div className="flex items-center gap-2">
                                          <button
                                             onClick={() => handleDownloadFilesOrFolders([viewingFile.name])}
                                             className="p-1 hover:bg-[#333] rounded text-neutral-400 hover:text-white transition"
                                             title="Download file"
                                          >
                                             <Download className="w-4 h-4" />
                                          </button>
                                          <button onClick={() => setViewingFile(null)} className="p-1 hover:bg-[#333] rounded text-neutral-500 hover:text-white transition">
                                             <X className="w-5 h-5" />
                                          </button>
                                       </div>
                                    </div>
                                    <pre className="flex-1 p-6 overflow-auto text-xs font-mono text-neutral-400 selection:bg-[#3E8ED0]/30 whitespace-pre scrollbar-custom">
                                       {viewingFile.content}
                                    </pre>
                                 </div>
                              ) : (
                                 <div
                                    className="flex-1 flex flex-col bg-[#1E1E1E]/50 border border-[#333] rounded-lg overflow-hidden shadow-2xl"
                                    onClick={(e) => {
                                       if (e.target === e.currentTarget) {
                                          setSelectedFileNames([]);
                                       }
                                    }}
                                 >
                                    {/* Table Header */}
                                    <div className="grid grid-cols-12 px-4 py-2.5 border-b border-[#333] text-[10px] uppercase font-bold text-neutral-400 tracking-wider bg-[#242424] items-center">
                                       <div className="col-span-1 flex items-center">
                                          <input
                                             type="checkbox"
                                             checked={fileList.length > 0 && selectedFileNames.length === fileList.length}
                                             onChange={(e) => {
                                                if (e.target.checked) {
                                                   setSelectedFileNames(fileList.map(f => f.name));
                                                } else {
                                                   setSelectedFileNames([]);
                                                }
                                             }}
                                             className="w-3.5 h-3.5 rounded bg-[#1A1A1A] border-[#444] text-[#3E8ED0] focus:ring-0 cursor-pointer"
                                          />
                                       </div>
                                       <div className="col-span-6">Name</div>
                                       <div className="col-span-2">Size</div>
                                       <div className="col-span-3">Modified</div>
                                    </div>

                                    {/* Table Body */}
                                    <div
                                       className="flex-1 overflow-auto max-h-[calc(85vh-250px)] scrollbar-custom"
                                       onClick={(e) => {
                                          if (e.target === e.currentTarget) {
                                             setSelectedFileNames([]);
                                          }
                                       }}
                                    >
                                       {/* Synthetic Inline Creation Row */}
                                       {inlineEditing && (inlineEditing.type === "new_file" || inlineEditing.type === "new_folder") && (
                                          <div className="grid grid-cols-12 px-4 py-2.5 border-b border-[#3E8ED0]/40 bg-[#3E8ED0]/10 items-center animate-in fade-in duration-150">
                                             <div className="col-span-1 flex items-center">
                                                {inlineEditing.type === "new_folder" ? (
                                                   <Folder className="w-4 h-4 text-yellow-500 fill-current" />
                                                ) : (
                                                   <FileText className="w-4 h-4 text-[#3E8ED0]" />
                                                )}
                                             </div>
                                             <div className="col-span-6 flex items-center gap-2">
                                                <input
                                                   type="text"
                                                   autoFocus
                                                   placeholder={inlineEditing.type === "new_folder" ? "Folder name..." : "File name..."}
                                                   value={inlineEditing.value}
                                                   onChange={(e) => setInlineEditing(prev => prev ? { ...prev, value: e.target.value } : null)}
                                                   onKeyDown={(e) => {
                                                      if (e.key === "Enter") {
                                                         handleCreateFileOrFolder(inlineEditing.value, inlineEditing.type === "new_folder");
                                                      } else if (e.key === "Escape") {
                                                         setInlineEditing(null);
                                                      }
                                                   }}
                                                   onBlur={() => {
                                                      if (inlineEditing.value.trim()) {
                                                         handleCreateFileOrFolder(inlineEditing.value, inlineEditing.type === "new_folder");
                                                      } else {
                                                         setInlineEditing(null);
                                                      }
                                                   }}
                                                   className="bg-[#141414] border border-[#3E8ED0] rounded px-2 py-1 text-xs text-white focus:outline-none w-full"
                                                />
                                             </div>
                                             <div className="col-span-5 text-neutral-500 text-[11px] italic">
                                                Press Enter to save, Esc to cancel
                                             </div>
                                          </div>
                                       )}

                                       {isFilesLoading ? (
                                          <div className="flex flex-col items-center justify-center h-64 text-neutral-500 gap-3">
                                             <RefreshCw className="w-8 h-8 animate-spin text-[#3E8ED0]" />
                                             <span className="text-sm font-medium">Scanning directory...</span>
                                          </div>
                                       ) : fileList.length === 0 && !inlineEditing ? (
                                          <div
                                             className="flex flex-col items-center justify-center h-64 text-neutral-500 gap-2 opacity-60"
                                             onContextMenu={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setFileContextMenu({ x: e.clientX, y: e.clientY, target: null });
                                             }}
                                          >
                                             <Box className="w-10 h-10" />
                                             <span className="text-sm">Empty folder</span>
                                             <span className="text-xs text-neutral-600">Drag files here to upload or right-click to create</span>
                                          </div>
                                       ) : (
                                          fileList.map((file, i) => {
                                             const isText = ['.txt', '.log', '.properties', '.yml', '.yaml', '.json', '.conf', '.cfg', '.env', '.toml'].includes(file.ext);
                                             const isSelected = selectedFileNames.includes(file.name);
                                             const isEditingThis = inlineEditing?.type === "rename" && inlineEditing?.targetName === file.name;
                                             const folderFullPath = currentFilePath === "." ? file.name : `${currentFilePath}/${file.name}`;
                                             const isDropTarget = file.is_dir && dragTargetFolder === folderFullPath;
                                             const isCut = fileClipboard?.action === "cut" && fileClipboard.sourceDir === currentFilePath && fileClipboard.files.includes(file.name);

                                             return (
                                                <div
                                                   key={i}
                                                   draggable={!isEditingThis}
                                                   onDragStart={(e) => {
                                                      const dragged = selectedFileNames.includes(file.name) ? selectedFileNames : [file.name];
                                                      setDraggedFileNames(dragged);
                                                      e.dataTransfer.setData("text/plain", file.name);
                                                      e.dataTransfer.effectAllowed = "move";
                                                   }}
                                                   onDragOver={(e) => {
                                                      if (file.is_dir) {
                                                         e.preventDefault();
                                                         e.stopPropagation();
                                                         if (dragTargetFolder !== folderFullPath) {
                                                            setDragTargetFolder(folderFullPath);
                                                         }
                                                      }
                                                   }}
                                                   onDragLeave={(e) => {
                                                      if (file.is_dir && dragTargetFolder === folderFullPath) {
                                                         setDragTargetFolder(null);
                                                      }
                                                   }}
                                                   onDrop={(e) => {
                                                      if (file.is_dir) {
                                                         e.preventDefault();
                                                         e.stopPropagation();
                                                         setDragTargetFolder(null);
                                                         if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                                                            handleUploadFileList(e.dataTransfer.files, folderFullPath);
                                                         } else if (draggedFileNames && draggedFileNames.length > 0) {
                                                            const sourcePaths = draggedFileNames.map(f => currentFilePath === "." ? f : `${currentFilePath}/${f}`);
                                                            handleExecuteMoveOrCopy("cut", sourcePaths, folderFullPath, "fail");
                                                            setDraggedFileNames(null);
                                                         }
                                                      }
                                                   }}
                                                   onClick={(e) => {
                                                      if (isEditingThis) return;
                                                      if (e.shiftKey && selectedFileNames.length > 0) {
                                                         const lastSelectedIdx = fileList.findIndex(f => f.name === selectedFileNames[selectedFileNames.length - 1]);
                                                         const start = Math.min(lastSelectedIdx, i);
                                                         const end = Math.max(lastSelectedIdx, i);
                                                         const slice = fileList.slice(start, end + 1).map(f => f.name);
                                                         setSelectedFileNames(Array.from(new Set([...selectedFileNames, ...slice])));
                                                      } else if (e.ctrlKey || e.metaKey) {
                                                         setSelectedFileNames(prev =>
                                                            prev.includes(file.name) ? prev.filter(n => n !== file.name) : [...prev, file.name]
                                                         );
                                                      } else {
                                                         setSelectedFileNames([file.name]);
                                                      }
                                                   }}
                                                   onDoubleClick={() => {
                                                      const newPath = currentFilePath === "." ? file.name : `${currentFilePath}/${file.name}`;
                                                      const instanceId = isGlobalBrowser ? null : selectedId;
                                                      if (file.is_dir) {
                                                         setSelectedFileNames([]);
                                                         fetchFileList(instanceId, newPath);
                                                      } else if (isText) {
                                                         handleOpenFile(instanceId, newPath, file.name);
                                                      }
                                                   }}
                                                   onContextMenu={(e) => {
                                                      e.preventDefault();
                                                      e.stopPropagation();
                                                      if (!selectedFileNames.includes(file.name)) {
                                                         setSelectedFileNames([file.name]);
                                                      }
                                                      setFileContextMenu({ x: e.clientX, y: e.clientY, target: file });
                                                   }}
                                                   className={`grid grid-cols-12 px-4 py-2.5 border-b border-[#282828] transition-colors cursor-pointer group items-center ${
                                                      isDropTarget
                                                         ? 'bg-[#3E8ED0]/20 ring-2 ring-inset ring-[#3E8ED0]'
                                                         : isSelected
                                                         ? 'bg-[#3E8ED0]/15 border-[#3E8ED0]/30'
                                                         : 'hover:bg-white/[0.04]'
                                                   } ${isCut ? 'opacity-40' : ''}`}
                                                >
                                                   {/* Checkbox */}
                                                   <div
                                                      className="col-span-1 flex items-center"
                                                      onClick={(e) => e.stopPropagation()}
                                                   >
                                                      <input
                                                         type="checkbox"
                                                         checked={isSelected}
                                                         onChange={(e) => {
                                                            if (e.target.checked) {
                                                               setSelectedFileNames(prev => [...prev, file.name]);
                                                            } else {
                                                               setSelectedFileNames(prev => prev.filter(n => n !== file.name));
                                                            }
                                                         }}
                                                         className="w-3.5 h-3.5 rounded bg-[#1A1A1A] border-[#444] text-[#3E8ED0] focus:ring-0 cursor-pointer"
                                                      />
                                                   </div>

                                                   {/* Name column */}
                                                   <div className="col-span-6 flex items-center gap-2.5 min-w-0 pr-2">
                                                      {file.is_dir ? (
                                                         <Folder className="w-4 h-4 text-yellow-500 fill-current shrink-0" />
                                                      ) : (
                                                         <FileText className="w-4 h-4 text-neutral-400 shrink-0" />
                                                      )}

                                                      {isEditingThis ? (
                                                         <input
                                                            type="text"
                                                            autoFocus
                                                            value={inlineEditing.value}
                                                            onClick={(e) => e.stopPropagation()}
                                                            onChange={(e) => setInlineEditing(prev => prev ? { ...prev, value: e.target.value } : null)}
                                                            onKeyDown={(e) => {
                                                               if (e.key === "Enter") {
                                                                  handleRenameFileOrFolder(file.name, inlineEditing.value);
                                                               } else if (e.key === "Escape") {
                                                                  setInlineEditing(null);
                                                               }
                                                            }}
                                                            onBlur={() => {
                                                               if (inlineEditing.value && inlineEditing.value !== file.name) {
                                                                  handleRenameFileOrFolder(file.name, inlineEditing.value);
                                                               } else {
                                                                  setInlineEditing(null);
                                                               }
                                                            }}
                                                            className="bg-[#141414] border border-[#3E8ED0] rounded px-1.5 py-0.5 text-xs text-white focus:outline-none w-full"
                                                         />
                                                      ) : (
                                                         <span className={`text-sm truncate ${file.is_dir ? 'text-neutral-200 font-medium' : 'text-neutral-300 font-normal'} group-hover:text-white transition-colors`}>
                                                            {file.name}
                                                         </span>
                                                      )}

                                                      {isText && !isEditingThis && (
                                                         <span
                                                            onClick={(e) => {
                                                               e.stopPropagation();
                                                               const instanceId = isGlobalBrowser ? null : selectedId;
                                                               handleOpenFile(instanceId, folderFullPath, file.name);
                                                            }}
                                                            className="bg-[#3E8ED0]/15 text-[9px] px-1.5 py-0.5 rounded text-[#3E8ED0] font-bold border border-[#3E8ED0]/30 hidden group-hover:block shrink-0 cursor-pointer hover:bg-[#3E8ED0]/30"
                                                         >
                                                            VIEW
                                                         </span>
                                                      )}
                                                   </div>

                                                   {/* Size column */}
                                                   <div className="col-span-2 text-xs text-neutral-400 flex items-center">
                                                      {file.is_dir ? '--' : (file.size > 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : `${(file.size / 1024).toFixed(1)} KB`)}
                                                   </div>

                                                   {/* Modified column */}
                                                   <div className="col-span-3 text-xs text-neutral-500 flex items-center justify-between pr-2">
                                                      <span>{new Date(file.modified * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>
                                                      <button
                                                         onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDownloadFilesOrFolders([file.name]);
                                                         }}
                                                         className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#333] rounded text-neutral-400 hover:text-white transition"
                                                         title="Download"
                                                      >
                                                         <Download className="w-3.5 h-3.5" />
                                                      </button>
                                                   </div>
                                                </div>
                                             );
                                          })
                                       )}
                                    </div>
                                 </div>
                              )}

                              {/* Right-Click Context Menu */}
                              {fileContextMenu && (
                                 <div
                                    className="fixed z-50 bg-[#222222] border border-[#3A3A3A] rounded-lg shadow-2xl py-1 text-xs text-neutral-200 min-w-[170px] backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
                                    style={{
                                       top: Math.min(fileContextMenu.y, window.innerHeight - 250),
                                       left: Math.min(fileContextMenu.x, window.innerWidth - 190)
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                 >
                                    {fileContextMenu.target ? (
                                       <>
                                          {fileContextMenu.target.is_dir ? (
                                             <button
                                                onClick={() => {
                                                   const newPath = currentFilePath === "." ? fileContextMenu.target.name : `${currentFilePath}/${fileContextMenu.target.name}`;
                                                   const instanceId = isGlobalBrowser ? null : selectedId;
                                                   setSelectedFileNames([]);
                                                   fetchFileList(instanceId, newPath);
                                                   setFileContextMenu(null);
                                                }}
                                                className="w-full text-left px-3 py-1.5 hover:bg-[#3E8ED0] hover:text-white flex items-center gap-2 transition"
                                             >
                                                <Folder className="w-3.5 h-3.5 text-yellow-500" /> Open Folder
                                             </button>
                                          ) : (
                                             <button
                                                onClick={() => {
                                                   const newPath = currentFilePath === "." ? fileContextMenu.target.name : `${currentFilePath}/${fileContextMenu.target.name}`;
                                                   const instanceId = isGlobalBrowser ? null : selectedId;
                                                   handleOpenFile(instanceId, newPath, fileContextMenu.target.name);
                                                   setFileContextMenu(null);
                                                }}
                                                className="w-full text-left px-3 py-1.5 hover:bg-[#3E8ED0] hover:text-white flex items-center gap-2 transition"
                                             >
                                                <FileText className="w-3.5 h-3.5 text-[#3E8ED0]" /> View Content
                                             </button>
                                          )}

                                          <button
                                             onClick={() => {
                                                const targets = selectedFileNames.includes(fileContextMenu.target.name)
                                                   ? selectedFileNames
                                                   : [fileContextMenu.target.name];
                                                handleDownloadFilesOrFolders(targets);
                                                setFileContextMenu(null);
                                             }}
                                             className="w-full text-left px-3 py-1.5 hover:bg-[#3E8ED0] hover:text-white flex items-center gap-2 transition"
                                          >
                                             <Download className="w-3.5 h-3.5 text-blue-400" /> Download
                                          </button>

                                          <div className="h-[1px] bg-[#333] my-1" />

                                          <button
                                             onClick={() => {
                                                setInlineEditing({
                                                   type: "rename",
                                                   targetName: fileContextMenu.target.name,
                                                   value: fileContextMenu.target.name
                                                });
                                                setFileContextMenu(null);
                                             }}
                                             className="w-full text-left px-3 py-1.5 hover:bg-[#3E8ED0] hover:text-white flex items-center gap-2 transition"
                                          >
                                             <Edit className="w-3.5 h-3.5 text-neutral-400" /> Rename (F2)
                                          </button>

                                          <button
                                             onClick={() => {
                                                const targets = selectedFileNames.includes(fileContextMenu.target.name)
                                                   ? selectedFileNames
                                                   : [fileContextMenu.target.name];
                                                setFileClipboard({
                                                   action: "cut",
                                                   files: targets,
                                                   sourceDir: currentFilePath,
                                                   instanceId: isGlobalBrowser ? null : selectedId
                                                });
                                                setFileContextMenu(null);
                                             }}
                                             className="w-full text-left px-3 py-1.5 hover:bg-[#3E8ED0] hover:text-white flex items-center gap-2 transition"
                                          >
                                             <Scissors className="w-3.5 h-3.5 text-neutral-400" /> Cut (Ctrl+X)
                                          </button>

                                          <button
                                             onClick={() => {
                                                const targets = selectedFileNames.includes(fileContextMenu.target.name)
                                                   ? selectedFileNames
                                                   : [fileContextMenu.target.name];
                                                setFileClipboard({
                                                   action: "copy",
                                                   files: targets,
                                                   sourceDir: currentFilePath,
                                                   instanceId: isGlobalBrowser ? null : selectedId
                                                });
                                                setFileContextMenu(null);
                                             }}
                                             className="w-full text-left px-3 py-1.5 hover:bg-[#3E8ED0] hover:text-white flex items-center gap-2 transition"
                                          >
                                             <Copy className="w-3.5 h-3.5 text-neutral-400" /> Copy (Ctrl+C)
                                          </button>

                                          <div className="h-[1px] bg-[#333] my-1" />

                                          <button
                                             onClick={() => {
                                                const targets = selectedFileNames.includes(fileContextMenu.target.name)
                                                   ? selectedFileNames
                                                   : [fileContextMenu.target.name];
                                                handleDeleteFilesOrFolders(targets);
                                                setFileContextMenu(null);
                                             }}
                                             className="w-full text-left px-3 py-1.5 hover:bg-red-600 hover:text-white text-red-400 flex items-center gap-2 transition"
                                          >
                                             <Trash2 className="w-3.5 h-3.5" /> Delete (Del)
                                          </button>
                                       </>
                                    ) : (
                                       <>
                                          <button
                                             onClick={() => {
                                                setInlineEditing({ type: "new_file", value: "" });
                                                setFileContextMenu(null);
                                             }}
                                             className="w-full text-left px-3 py-1.5 hover:bg-[#3E8ED0] hover:text-white flex items-center gap-2 transition"
                                          >
                                             <FilePlus className="w-3.5 h-3.5 text-[#3E8ED0]" /> New File
                                          </button>

                                          <button
                                             onClick={() => {
                                                setInlineEditing({ type: "new_folder", value: "" });
                                                setFileContextMenu(null);
                                             }}
                                             className="w-full text-left px-3 py-1.5 hover:bg-[#3E8ED0] hover:text-white flex items-center gap-2 transition"
                                          >
                                             <FolderPlus className="w-3.5 h-3.5 text-yellow-500" /> New Folder
                                          </button>

                                          <button
                                             onClick={() => {
                                                fileUploadInputRef.current?.click();
                                                setFileContextMenu(null);
                                             }}
                                             className="w-full text-left px-3 py-1.5 hover:bg-[#3E8ED0] hover:text-white flex items-center gap-2 transition"
                                          >
                                             <Upload className="w-3.5 h-3.5 text-green-400" /> Upload Files...
                                          </button>

                                          {fileClipboard && (
                                             <button
                                                onClick={() => {
                                                   handlePasteClipboard();
                                                   setFileContextMenu(null);
                                                }}
                                                className="w-full text-left px-3 py-1.5 hover:bg-[#3E8ED0] hover:text-white flex items-center gap-2 transition"
                                             >
                                                <Clipboard className="w-3.5 h-3.5 text-neutral-300" /> Paste ({fileClipboard.files.length})
                                             </button>
                                          )}

                                          <div className="h-[1px] bg-[#333] my-1" />

                                          <button
                                             onClick={() => {
                                                setSelectedFileNames(fileList.map(f => f.name));
                                                setFileContextMenu(null);
                                             }}
                                             className="w-full text-left px-3 py-1.5 hover:bg-[#3E8ED0] hover:text-white flex items-center gap-2 transition"
                                          >
                                             <Check className="w-3.5 h-3.5" /> Select All (Ctrl+A)
                                          </button>

                                          <button
                                             onClick={() => {
                                                fetchFileList(isGlobalBrowser ? null : selectedId, currentFilePath);
                                                setFileContextMenu(null);
                                             }}
                                             className="w-full text-left px-3 py-1.5 hover:bg-[#3E8ED0] hover:text-white flex items-center gap-2 transition"
                                          >
                                             <RefreshCw className="w-3.5 h-3.5" /> Refresh
                                          </button>
                                       </>
                                    )}
                                 </div>
                              )}

                              {/* Conflict Modal */}
                              {fileConflictModal && (
                                 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
                                    <div className="bg-[#242424] border border-[#3E3E3E] rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4">
                                       <div className="flex items-center gap-3 text-amber-400">
                                          <AlertCircle className="w-6 h-6 shrink-0" />
                                          <h4 className="text-lg font-bold text-white">{fileConflictModal.title}</h4>
                                       </div>
                                       <p className="text-xs text-neutral-300 whitespace-pre-line leading-relaxed">
                                          {fileConflictModal.message}
                                       </p>
                                       <div className="flex justify-end gap-2 pt-2">
                                          <button
                                             onClick={() => fileConflictModal.onResolve("cancel")}
                                             className="px-3 py-1.5 bg-[#333] hover:bg-[#444] rounded text-xs text-neutral-300 transition"
                                          >
                                             Cancel
                                          </button>
                                          <button
                                             onClick={() => fileConflictModal.onResolve("rename_new")}
                                             className="px-3 py-1.5 bg-[#3E8ED0]/20 hover:bg-[#3E8ED0]/30 border border-[#3E8ED0]/40 rounded text-xs text-[#3E8ED0] font-semibold transition"
                                          >
                                             Keep Both (Auto-Rename)
                                          </button>
                                          <button
                                             onClick={() => fileConflictModal.onResolve("overwrite")}
                                             className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded text-xs text-white font-semibold transition shadow-md"
                                          >
                                             Overwrite
                                          </button>
                                       </div>
                                    </div>
                                 </div>
                              )}
                           </div>
                        )}

                        {editTab === "config" && (
                           <div className="flex flex-col h-full p-8 overflow-auto">
                              <div className="max-w-4xl w-full mx-auto">
                                 <div className="flex items-center gap-3 mb-6">
                                    <Settings className="w-6 h-6 text-[#3E8ED0]" />
                                    <h3 className="text-xl font-bold">Advanced: RAW Environment</h3>
                                 </div>

                                 <div className="space-y-6">
                                    <div className="bg-[#242424] border border-[#3A3A3A] rounded-lg overflow-hidden">
                                       <div className="px-4 py-2.5 bg-[#2D2D2D] border-b border-[#3A3A3A] flex justify-between items-center">
                                          <span className="text-xs font-bold text-neutral-400 uppercase">Environment Variables</span>
                                       </div>
                                       <div className="p-4 space-y-3">
                                          {Object.entries(config.environment).map(([k, v]) => (
                                             <div key={k} className="flex gap-2">
                                                <input
                                                   type="text"
                                                   readOnly
                                                   value={k}
                                                   className="flex-[0.4] bg-[#1A1A1A] border border-[#333] p-2 rounded text-xs font-mono text-[#3E8ED0] focus:outline-none"
                                                />
                                                <input
                                                   type="text"
                                                   value={v}
                                                   onChange={(e) => setConfig(prev => ({
                                                      ...prev,
                                                      environment: { ...prev.environment, [k]: e.target.value }
                                                   }))}
                                                   className="flex-1 bg-[#141414] border border-[#3A3A3A] p-2 rounded text-xs font-mono text-neutral-200 focus:outline-none focus:border-[#3E8ED0]"
                                                />
                                             </div>
                                          ))}
                                       </div>
                                    </div>



                                    <div className="bg-[#3D2525]/10 border border-[#4D2525] p-4 rounded-lg">
                                       <div className="flex items-center gap-2 text-red-400 mb-2 font-bold text-sm">
                                          <AlertCircle className="w-4 h-4" /> Hard Reset
                                       </div>
                                       <p className="text-xs text-neutral-500 mb-3 leading-relaxed">
                                          Manually editing the environment variables can cause the container to fail if invalid values are provided.
                                          It is recommended to use the dedicated tabs for Versions, Loaders, and Mods.
                                       </p>
                                    </div>
                                 </div>
                              </div>
                           </div>
                        )}
                     </div>
                  </div>

                  {/* Server Status Bar for Editing View */}
                  {!isGlobalBrowser && selectedInstance && (() => {
                     const status = statuses[selectedInstance.id];
                     const isRunning = status?.is_running;
                     const isReady = status?.is_ready;
                     const isStopping = status?.startup_status === "Stopping..." || status?.startup_status === "Killing...";
                     const isRestarting = status?.startup_status === "Restarting...";
                     const isStarting = isRunning && !isReady && !isStopping;
                     const showProgress = isStarting || isStopping || isRestarting;
                     const pct = status?.startup_percent || (isStopping ? 70 : (isRestarting ? 25 : 10));

                     const version = config.environment?.["VERSION"] || status?.version || "Unknown";
                     const loader = config.environment?.["TYPE"] || "VANILLA";
                     const port = status?.port || config.environment?.["SERVER_PORT"] || 25565;
                     const address = status?.public_ip ? `${status.public_ip}:${port}` : `localhost:${port}`;

                     return (
                        <div className="bg-[#1C1C1C] border-t border-[#3A3A3A] px-5 py-2.5 flex flex-col gap-2 select-none shadow-2xl z-20">
                           {/* Progress Bar Section (Visible during Starting, Stopping, or Restarting) */}
                           {showProgress && (
                              <div className="w-full bg-[#141414] border border-[#2F2F2F] rounded-lg p-2.5 flex flex-col gap-1.5 shadow-inner animate-in fade-in slide-in-from-bottom-1 duration-200">
                                 <div className="flex justify-between items-center text-[11px] font-mono">
                                    <div className="flex items-center gap-2">
                                       <RefreshCw className={`w-3.5 h-3.5 animate-spin ${isStopping ? 'text-amber-400' : 'text-[#3E8ED0]'}`} />
                                       <span className={`font-semibold ${isStopping ? 'text-amber-300' : 'text-neutral-200'}`}>
                                          {status?.startup_status || (isStopping ? "Stopping server..." : "Starting server...")}
                                       </span>
                                    </div>
                                    <span className="font-bold text-neutral-300 bg-[#242424] px-2 py-0.5 rounded border border-[#383838] text-[10px]">
                                       {pct}%
                                    </span>
                                 </div>
                                 <div className="w-full bg-[#262626] rounded-full h-1.5 overflow-hidden">
                                    <div
                                       className={`h-full rounded-full transition-all duration-300 ease-out ${isStopping
                                             ? 'bg-gradient-to-r from-amber-600 to-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                                             : 'bg-gradient-to-r from-[#3E8ED0] to-cyan-400 shadow-[0_0_8px_rgba(62,142,208,0.5)]'
                                          }`}
                                       style={{ width: `${Math.max(5, Math.min(100, pct))}%` }}
                                    />
                                 </div>
                              </div>
                           )}

                           {/* Status Bar Controls & Metadata */}
                           <div className="flex items-center justify-between flex-wrap gap-3">
                              {/* Left: Server Status & Metadata */}
                              <div className="flex items-center gap-3">
                                 {/* Status Badge */}
                                 <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-bold transition-colors ${isReady
                                       ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                       : isRunning
                                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                                          : isStopping
                                             ? 'bg-red-500/10 border-red-500/30 text-red-400'
                                             : 'bg-neutral-800 border-neutral-700 text-neutral-400'
                                    }`}>
                                    <span className="relative flex h-2 w-2">
                                       {isRunning && (
                                          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isReady ? 'bg-emerald-400' : 'bg-amber-400'
                                             }`} />
                                       )}
                                       <span className={`relative inline-flex rounded-full h-2 w-2 ${isReady ? 'bg-emerald-500' : (isRunning ? 'bg-amber-500' : 'bg-neutral-500')
                                          }`} />
                                    </span>
                                    <span>
                                       {!isRunning
                                          ? (isStopping ? 'STOPPING...' : 'OFFLINE')
                                          : (isReady ? 'ONLINE' : (status?.startup_status || 'STARTING...'))}
                                    </span>
                                 </div>

                                 {/* Version & Loader Pill */}
                                 <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#242424] border border-[#333] text-[11px] text-neutral-300 font-mono">
                                    <span className="text-neutral-500 font-bold uppercase">{loader}</span>
                                    <span className="text-neutral-300">{version}</span>
                                 </div>

                                 {/* Address Pill */}
                                 {status?.public_ip && (
                                    <button
                                       onClick={() => copyToClipboard(address, 'statusBar')}
                                       className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#242424] hover:bg-[#2A2A2A] border border-[#333] hover:border-[#444] text-[11px] font-mono transition group"
                                       title="Click to copy server address"
                                    >
                                       <span className="text-neutral-500 font-bold text-[10px]">IP:</span>
                                       <span className={copiedId === 'statusBar' ? 'text-emerald-400 font-bold' : 'text-neutral-300'}>
                                          {copiedId === 'statusBar' ? 'COPIED!' : address}
                                       </span>
                                       <Copy className={`w-3 h-3 ${copiedId === 'statusBar' ? 'text-emerald-400' : 'text-neutral-500 group-hover:text-[#3E8ED0]'}`} />
                                    </button>
                                 )}
                              </div>

                              {/* Right: Quick Action Controls */}
                              <div className="flex items-center gap-2 ml-auto">
                                 {editTab !== "logs" && (
                                    <button
                                       onClick={() => setEditTab("logs")}
                                       className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#262626] hover:bg-[#323232] text-neutral-300 hover:text-white font-semibold text-xs border border-[#383838] transition-all"
                                       title="Switch to live Minecraft logs"
                                    >
                                       <Terminal className="w-3.5 h-3.5 text-[#3E8ED0]" />
                                       <span>Console</span>
                                    </button>
                                 )}

                                 {!isRunning ? (
                                    <button
                                       onClick={(e) => handleStart(selectedInstance.id, e)}
                                       className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-600/20 transition-all"
                                    >
                                       <Play className="w-3.5 h-3.5 fill-current" />
                                       <span>Start Server</span>
                                    </button>
                                 ) : (
                                    <>
                                       <button
                                          onClick={() => handleRestart(selectedInstance.id)}
                                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2A2A2A] hover:bg-[#333] text-neutral-200 font-bold text-xs border border-[#3E3E3E] transition-all"
                                          title="Restart Minecraft server"
                                       >
                                          <RotateCcw className="w-3.5 h-3.5 text-neutral-400" />
                                          <span>Restart</span>
                                       </button>
                                       <button
                                          onClick={(e) => handleStop(selectedInstance.id, e)}
                                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow-md shadow-amber-600/20 transition-all"
                                       >
                                          <Square className="w-3.5 h-3.5 fill-current" />
                                          <span>Stop Server</span>
                                       </button>
                                       <button
                                          onClick={(e) => handleKill(selectedInstance.id, e)}
                                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-400 hover:text-red-300 font-bold text-xs border border-red-900/40 transition-all"
                                          title="Force kill server if unresponsive"
                                       >
                                          <Skull className="w-3.5 h-3.5" />
                                       </button>
                                    </>
                                 )}
                              </div>
                           </div>
                        </div>
                     );
                  })()}
               </div>
            </div>
         )}
         {isVersionModalOpen && (
            <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-6">
               <div className="bg-[#1E1E1E] border border-[#3A3A3A] rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="p-6 border-b border-[#3A3A3A] flex justify-between items-center bg-[#242424]">
                     <div className="flex items-center gap-3">
                        <Database className="w-6 h-6 text-[#3E8ED0]" />
                        <h3 className="text-xl font-bold text-white">Change Minecraft Version</h3>
                     </div>
                     <button onClick={() => setIsVersionModalOpen(false)} className="text-neutral-500 hover:text-white transition">
                        <X className="w-6 h-6" />
                     </button>
                  </div>

                  <div className="p-8 space-y-8">
                     <div className="flex items-center justify-center gap-8 py-4">
                        <div className="flex flex-col items-center gap-2">
                           <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Current</span>
                           <div className="px-4 py-2 bg-[#2D2D2D] rounded border border-[#3A3A3A] font-mono text-[#3E8ED0] font-bold shadow-inner">
                              {config.environment["VERSION"] || "latest"}
                           </div>
                        </div>
                        <ChevronRight className="w-6 h-6 text-neutral-600 mt-6" />
                        <div className="flex flex-col items-center gap-2">
                           <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Target</span>
                           <div className="px-4 py-2 bg-emerald-500/10 rounded border border-emerald-500/30 font-mono text-emerald-400 font-bold shadow-lg animate-pulse">
                              {pendingVersion}
                           </div>
                        </div>
                     </div>

                     <div className="space-y-4">
                        <div className="flex items-center gap-3 p-4 rounded-lg bg-[#242424] border border-[#333] hover:border-[#3E8ED0]/40 transition-colors cursor-pointer group" onClick={() => setUpdateLoader(!updateLoader)}>
                           <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${updateLoader ? 'bg-[#3E8ED0] border-[#3E8ED0]' : 'border-[#444] group-hover:border-[#555]'}`}>
                              {updateLoader && <Check className="w-3.5 h-3.5 text-white" />}
                           </div>
                           <div className="flex-1">
                              <p className="text-sm font-bold text-neutral-200">Automatically update Mod Loader</p>
                              <p className="text-xs text-neutral-500">Pick the latest recommended loader for {pendingVersion}</p>
                           </div>
                        </div>

                        <div className="flex items-center gap-3 p-4 rounded-lg bg-[#242424] border border-[#333] hover:border-[#3E8ED0]/40 transition-colors cursor-pointer group" onClick={() => setUpdateMods(!updateMods)}>
                           <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${updateMods ? 'bg-[#3E8ED0] border-[#3E8ED0]' : 'border-[#444] group-hover:border-[#555]'}`}>
                              {updateMods && <Check className="w-3.5 h-3.5 text-white" />}
                           </div>
                           <div className="flex-1">
                              <p className="text-sm font-bold text-neutral-200">Verify & Disable incompatible Mods</p>
                              <p className="text-xs text-neutral-500">Check compatibility and keep only working mods.</p>
                           </div>
                        </div>
                     </div>

                     {isCheckingCompatibility ? (
                        <div className="flex flex-col items-center justify-center p-8 bg-[#242424] border border-dashed border-[#333] rounded-lg gap-3">
                           <RefreshCw className="w-8 h-8 text-[#3E8ED0] animate-spin" />
                           <p className="text-sm text-neutral-400 font-medium">Checking mod compatibility with {pendingVersion}...</p>
                        </div>
                     ) : (
                        <div className="space-y-4 animate-in slide-in-from-top-2 duration-300">
                           {compatibility.incompatible.length > 0 && (
                              <div className="p-5 bg-red-500/10 border border-red-500/30 rounded-lg space-y-3 shadow-[0_0_20px_rgba(239,68,68,0.1)]">
                                 <div className="flex items-center gap-2 text-red-400 font-bold">
                                    <AlertCircle className="w-5 h-5" />
                                    <span>{compatibility.incompatible.length} Mods are INCOMPATIBLE!</span>
                                 </div>
                                 <p className="text-xs text-neutral-400 leading-relaxed">
                                    The following mods don't seem to have a version for <span className="font-bold text-white">{pendingVersion}</span> yet.
                                    If you proceed, they will be <span className="text-red-400 font-bold uppercase underline">automatically disabled</span> to prevent server crashes.
                                 </p>
                                 <div className="flex flex-wrap gap-2 pt-2">
                                    {compatibility.incompatible.map((m: any) => (
                                       <span key={m.id} className="text-[10px] px-2 py-1 bg-red-500/20 text-red-300 rounded-md border border-red-500/20 font-bold">
                                          {m.id}
                                       </span>
                                    ))}
                                 </div>
                              </div>
                           )}

                           {compatibility.compatible.length > 0 && (
                              <div className="flex items-center gap-2 text-emerald-500 text-xs font-bold px-1">
                                 <Check className="w-4 h-4" />
                                 <span>{compatibility.compatible.length} Mods verified compatible.</span>
                              </div>
                           )}

                           {compatibility.incompatible.length === 0 && compatibility.compatible.length === 0 && updateMods && (
                              <p className="text-xs text-neutral-500 italic text-center py-4">No mods detected to check compatibility for.</p>
                           )}
                        </div>
                     )}
                  </div>

                  <div className="p-6 bg-[#242424] border-t border-[#3A3A3A] flex gap-3">
                     <button
                        onClick={() => setIsVersionModalOpen(false)}
                        className="flex-1 px-4 py-3 bg-[#323232] hover:bg-[#404040] text-neutral-300 font-bold rounded-lg transition-all"
                     >
                        Cancel
                     </button>
                     <button
                        onClick={applyVersionChange}
                        disabled={isCheckingCompatibility}
                        className={`flex-[1.5] px-4 py-3 bg-[#3E8ED0] hover:bg-[#2B6A9E] text-white font-bold rounded-lg shadow-xl shadow-[#3E8ED0]/10 transition-all ${isCheckingCompatibility ? 'opacity-50 cursor-not-allowed' : ''}`}
                     >
                        Change to {pendingVersion}
                     </button>
                  </div>
               </div>
            </div>
         )}

         {isSettingsModalOpen && (
            <div className="absolute inset-0 z-[110] flex items-center justify-center bg-black/75 backdrop-blur-md p-6">
               <div className="bg-[#242424] border border-[#3A3A3A] rounded-xl shadow-2xl w-full max-w-4xl h-[70vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200 text-[#E0E0E0]">
                  {/* Header */}
                  <div className="px-6 py-5 border-b border-[#323232] bg-[#2B2B2B] flex justify-between items-center">
                     <div className="flex items-center gap-3">
                        <div className="p-2 bg-[#3E8ED0]/10 rounded-lg text-[#3E8ED0]">
                           <Settings className="w-6 h-6" />
                        </div>
                        <div>
                           <h2 className="text-xl font-bold text-white">Application Settings</h2>
                           <p className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold mt-0.5">Global Configuration & Defaults</p>
                        </div>
                     </div>
                     <div className="flex items-center gap-2">
                        <HelpButton topic={`settings-${settingsTab}`} className="p-1.5 hover:bg-[#3A3A3A] rounded-full text-neutral-400" iconClassName="w-5 h-5" />
                        <button
                           onClick={() => setIsSettingsModalOpen(false)}
                           className="p-1.5 hover:bg-[#3A3A3A] rounded-full text-neutral-400 hover:text-white transition"
                        >
                           <X className="w-6 h-6" />
                        </button>
                     </div>
                  </div>

                  <div className="flex-1 flex overflow-hidden">
                     {/* Sidebar */}
                     <div className="w-56 bg-[#1E1E1E] border-r border-[#323232] p-3 flex flex-col gap-1.5">
                        <h5 className="px-3 text-[10px] font-bold text-neutral-600 uppercase tracking-widest mb-1 mt-2">Preferences</h5>
                        {[
                           { id: "general", name: "General", icon: Monitor },
                           { id: "language", name: "Language", icon: Languages },
                           { id: "appearance", name: "Appearance", icon: Moon }
                        ].map((tab) => (
                           <button
                              key={tab.id}
                              onClick={() => setSettingsTab(tab.id)}
                              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${settingsTab === tab.id ? 'bg-[#3E8ED0] text-white shadow-lg' : 'text-neutral-400 hover:bg-[#323232] hover:text-neutral-200'}`}
                           >
                              <tab.icon className="w-4 h-4" />
                              {tab.name}
                           </button>
                        ))}

                        <h5 className="px-3 text-[10px] font-bold text-neutral-600 uppercase tracking-widest mb-1 mt-4">System</h5>
                        {[
                           { id: "defaults", name: "Server Defaults", icon: Database },
                           { id: "updates", name: "Updates", icon: RefreshCw },
                           { id: "advanced", name: "Advanced", icon: Shield }
                        ].map((tab) => (
                           <button
                              key={tab.id}
                              onClick={() => {
                                 setSettingsTab(tab.id);
                                 if (tab.id === "updates") checkSystemUpdates();
                              }}
                              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${settingsTab === tab.id ? 'bg-[#3E8ED0] text-white shadow-lg' : 'text-neutral-400 hover:bg-[#323232] hover:text-neutral-200'}`}
                           >
                              <tab.icon className="w-4 h-4" />
                              {tab.name}
                           </button>
                        ))}
                     </div>

                     {/* Content Area */}
                     <div className="flex-1 bg-[#1A1A1A] p-8 overflow-auto scrollbar-custom text-[#E0E0E0]">
                        {settingsTab === "general" && (
                           <div className="space-y-8 animate-in slide-in-from-bottom-2 duration-300">
                              <div>
                                 <h3 className="text-lg font-bold mb-1">General Settings</h3>
                                 <p className="text-sm text-neutral-500">Configure basic application behavior.</p>
                              </div>
                              <div className="space-y-4">
                                 <div className="flex items-center justify-between p-4 bg-[#242424] rounded-lg border border-[#333]">
                                    <div className="flex flex-col">
                                       <span className="font-bold text-sm">Automatic Refresh</span>
                                       <span className="text-xs text-neutral-500">Auto-update instance statuses every 5 seconds.</span>
                                    </div>
                                    <button
                                       onClick={() => setGlobalSettings({ ...globalSettings, autoRefresh: !globalSettings.autoRefresh })}
                                       className={`w-12 h-6 rounded-full transition-all relative ${globalSettings.autoRefresh ? 'bg-emerald-500' : 'bg-[#333]'}`}
                                    >
                                       <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${globalSettings.autoRefresh ? 'left-7' : 'left-1'}`} />
                                    </button>
                                 </div>
                                 <div className="flex items-center justify-between p-4 bg-[#242424] rounded-lg border border-[#333]">
                                    <div className="flex flex-col">
                                       <span className="font-bold text-sm">Show Snapshots</span>
                                       <span className="text-xs text-neutral-500">Show Minecraft snapshots in version selection by default.</span>
                                    </div>
                                    <button
                                       onClick={() => setGlobalSettings({ ...globalSettings, showSnapshots: !globalSettings.showSnapshots })}
                                       className={`w-12 h-6 rounded-full transition-all relative ${globalSettings.showSnapshots ? 'bg-[#3E8ED0]' : 'bg-[#333]'}`}
                                    >
                                       <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${globalSettings.showSnapshots ? 'left-7' : 'left-1'}`} />
                                    </button>
                                 </div>
                              </div>
                           </div>
                        )}

                        {settingsTab === "language" && (
                           <div className="space-y-8 animate-in slide-in-from-bottom-2 duration-300">
                              <div>
                                 <h3 className="text-lg font-bold mb-1">Language</h3>
                                 <p className="text-sm text-neutral-500">Select your preferred interface language.</p>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                 {['English', 'Spanish', 'French', 'German', 'Russian', 'Chinese', 'Japanese'].map((lang) => (
                                    <button
                                       key={lang}
                                       onClick={() => setGlobalSettings({ ...globalSettings, language: lang })}
                                       className={`flex items-center justify-between p-4 rounded-lg border transition-all ${globalSettings.language === lang ? 'border-[#3E8ED0] bg-[#3E8ED0]/10 text-white' : 'border-[#333] bg-[#242424] text-neutral-400 hover:border-[#444]'}`}
                                    >
                                       <span className="font-bold text-sm">{lang}</span>
                                       {globalSettings.language === lang && <Check className="w-4 h-4" />}
                                    </button>
                                 ))}
                              </div>
                           </div>
                        )}

                        {settingsTab === "appearance" && (
                           <div className="space-y-8 animate-in slide-in-from-bottom-2 duration-300">
                              <div>
                                 <h3 className="text-lg font-bold mb-1">Appearance</h3>
                                 <p className="text-sm text-neutral-500">Customize the look and feel of Isopod.</p>
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                 {[
                                    { id: 'Dark', name: 'Dark Mode', icon: Moon },
                                    { id: 'Light', name: 'Light Mode', icon: Sun }
                                 ].map((theme) => (
                                    <button
                                       key={theme.id}
                                       onClick={() => setGlobalSettings({ ...globalSettings, theme: theme.id })}
                                       className={`flex flex-col items-center gap-3 p-6 rounded-xl border transition-all ${globalSettings.theme === theme.id ? 'border-[#3E8ED0] bg-[#3E8ED0]/15' : 'border-[#333] bg-[#242424] grayscale opacity-60 hover:grayscale-0 hover:opacity-100 hover:border-[#444]'}`}
                                    >
                                       <theme.icon className={`w-8 h-8 ${globalSettings.theme === theme.id ? 'text-[#3E8ED0]' : 'text-neutral-500'}`} />
                                       <span className={`font-bold text-sm ${globalSettings.theme === theme.id ? 'text-white' : 'text-neutral-400'}`}>{theme.name}</span>
                                    </button>
                                 ))}
                              </div>
                           </div>
                        )}

                        {settingsTab === "defaults" && (
                           <div className="space-y-8 animate-in slide-in-from-bottom-2 duration-300">
                              <div>
                                 <h3 className="text-lg font-bold mb-1">Server Defaults</h3>
                                 <p className="text-sm text-neutral-500">Initial values for new server instances.</p>
                              </div>
                              <div className="space-y-6">
                                 <div className="flex flex-col gap-2">
                                    <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Default Port Range Start</label>
                                    <input
                                       type="number"
                                       value={globalSettings.defaultPort}
                                       onChange={(e) => setGlobalSettings({ ...globalSettings, defaultPort: e.target.value })}
                                       className="w-full bg-[#141414] border border-[#333] p-3 rounded-lg focus:outline-none focus:border-[#3E8ED0] text-sm font-mono text-emerald-400"
                                    />
                                 </div>
                                 <div className="flex flex-col gap-2">
                                    <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Default Mod Loader</label>
                                    <div className="grid grid-cols-5 gap-2">
                                       {['VANILLA', 'FABRIC', 'FORGE', 'QUILT', 'NEOFORGE'].map((loader) => (
                                          <button
                                             key={loader}
                                             onClick={() => setGlobalSettings({ ...globalSettings, defaultLoader: loader })}
                                             className={`py-2 rounded-md border text-[10px] font-bold transition-all ${globalSettings.defaultLoader === loader ? 'border-[#3E8ED0] bg-[#3E8ED0] text-white' : 'border-[#333] bg-[#242424] text-neutral-500 hover:border-[#444]'}`}
                                          >
                                             {loader}
                                          </button>
                                       ))}
                                    </div>
                                 </div>

                                 <div className="flex flex-col gap-3 pt-2 text-[#E0E0E0]">
                                    <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest pl-1">Default RAM Allocation</label>
                                    <div className="flex gap-3">
                                       <input
                                          type="text"
                                          value={globalSettings.defaultMemory}
                                          onChange={(e) => setGlobalSettings({ ...globalSettings, defaultMemory: e.target.value })}
                                          placeholder="1G"
                                          className="flex-1 bg-[#141414] border border-[#333] p-3 rounded-lg focus:outline-none focus:border-[#3E8ED0] text-sm font-mono text-[#3E8ED0]"
                                       />
                                       <div className="flex bg-[#242424] rounded-lg p-1 border border-[#333] gap-1">
                                          {['1G', '2G', '4G', '6G', '8G'].map(m => (
                                             <button
                                                key={m}
                                                type="button"
                                                onClick={() => setGlobalSettings({ ...globalSettings, defaultMemory: m })}
                                                className={`px-4 py-1.5 rounded-md text-[10px] font-bold transition-all ${globalSettings.defaultMemory === m ? 'bg-[#3E8ED0] text-white' : 'text-neutral-500 hover:text-white'}`}
                                             >
                                                {m}
                                             </button>
                                          ))}
                                       </div>
                                    </div>
                                    <p className="text-[10px] text-neutral-600 px-1">Memory allocated to new Minecraft server instances by default.</p>
                                 </div>

                                 <div className="pt-4 border-t border-[#333] space-y-4">
                                    <div className="flex items-center justify-between">
                                       <div className="flex flex-col">
                                          <span className="font-bold text-sm text-neutral-200">Default Whitelist</span>
                                          <span className="text-xs text-neutral-500">Enable whitelist by default for new servers.</span>
                                       </div>
                                       <button
                                          onClick={() => setGlobalSettings({ ...globalSettings, defaultWhitelistEnabled: !globalSettings.defaultWhitelistEnabled })}
                                          className={`w-12 h-6 rounded-full transition-all relative ${globalSettings.defaultWhitelistEnabled ? 'bg-amber-500' : 'bg-[#333]'}`}
                                       >
                                          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${globalSettings.defaultWhitelistEnabled ? 'left-7' : 'left-1'}`} />
                                       </button>
                                    </div>

                                    <div className="space-y-3 pt-2 border-t border-[#333]">
                                       <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest block">Default Whitelisted Players ({globalSettings.defaultWhitelistUsers.length})</label>
                                          <div className="flex gap-2">
                                             <div className="relative flex-1">
                                                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-sm bg-[#1A1A1A] border border-[#333] flex items-center justify-center overflow-hidden">
                                                   {whitelistPreview ? (
                                                      <img
                                                         src={getPlayerAvatarUrl(whitelistPreview.uuid || whitelistPreview.name, 32)}
                                                         referrerPolicy="no-referrer"
                                                         alt=""
                                                         className="w-full h-full"
                                                         onError={(e) => {
                                                            e.currentTarget.src = `https://crafthead.net/avatar/${newWhitelistUser}/32`;
                                                         }}
                                                      />
                                                   ) : (
                                                      <Users className="w-3 h-3 text-neutral-500" />
                                                   )}
                                                </div>
                                                <input
                                                   type="text"
                                                   value={newWhitelistUser}
                                                   onChange={(e) => setNewWhitelistUser(e.target.value)}
                                                   onKeyDown={(e) => {
                                                      if (e.key === 'Enter' && newWhitelistUser) {
                                                         if (!globalSettings.defaultWhitelistUsers.includes(newWhitelistUser.trim())) {
                                                            setGlobalSettings({
                                                               ...globalSettings,
                                                               defaultWhitelistUsers: [...globalSettings.defaultWhitelistUsers, newWhitelistUser.trim()]
                                                            });
                                                         }
                                                         setNewWhitelistUser("");
                                                         setWhitelistPreview(null);
                                                      }
                                                   }}
                                                   placeholder="Add username..."
                                                   className="w-full bg-[#141414] border border-[#333] pl-10 pr-4 py-2.5 rounded-lg focus:outline-none focus:border-amber-500/50 text-sm placeholder:text-neutral-700"
                                                />
                                                {isVerifyingUser && (
                                                   <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                      <RefreshCw className="w-3 h-3 animate-spin text-neutral-600" />
                                                   </div>
                                                )}

                                                {/* Dropdown Suggestions */}
                                                {newWhitelistUser.length >= 1 && (
                                                   <div className="absolute top-full left-0 right-0 mt-1 bg-[#1E1E1E] border border-[#333] rounded-lg shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                                                      {seenPlayers.filter(p => p.name.toLowerCase().includes(newWhitelistUser.toLowerCase())).slice(0, 5).map(p => (
                                                         <div
                                                            key={p.uuid}
                                                            onClick={() => {
                                                               setNewWhitelistUser(p.name);
                                                               setWhitelistPreview(p);
                                                            }}
                                                            className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#333] cursor-pointer border-b border-[#282828] last:border-0 group"
                                                         >
                                                            <img src={getPlayerAvatarUrl(p.uuid || p.name, 16)} alt="" className="w-4 h-4 rounded-sm" onError={(e) => { e.currentTarget.src = `https://crafthead.net/avatar/${p.name}/16`; }} />
                                                            <span className="text-sm font-medium text-neutral-300 group-hover:text-white">{p.name}</span>
                                                            <span className="text-[10px] text-neutral-600 font-mono ml-auto">RECENT</span>
                                                         </div>
                                                      ))}
                                                   </div>
                                                )}
                                             </div>
                                             <button
                                                onClick={() => {
                                                   if (newWhitelistUser.trim() && !globalSettings.defaultWhitelistUsers.includes(newWhitelistUser.trim())) {
                                                      setGlobalSettings({
                                                         ...globalSettings,
                                                         defaultWhitelistUsers: [...globalSettings.defaultWhitelistUsers, newWhitelistUser.trim()]
                                                      });
                                                      setNewWhitelistUser("");
                                                      setWhitelistPreview(null);
                                                   }
                                                }}
                                                className="px-4 py-2 bg-[#333] hover:bg-[#444] rounded-lg text-sm font-bold transition-all border border-[#444]"
                                             >
                                                Add
                                             </button>
                                          </div>

                                          <div className="flex flex-wrap gap-2 min-h-[40px] p-3 bg-[#141414] rounded-lg border border-[#333]">
                                             {globalSettings.defaultWhitelistUsers.length === 0 ? (
                                                <span className="text-xs text-neutral-600 italic text-center w-full py-2">No default users added.</span>
                                             ) : (
                                                globalSettings.defaultWhitelistUsers.map(user => (
                                                   <div key={user} className="flex items-center gap-2 px-2.5 py-1 bg-[#242424] border border-[#333] rounded-md text-xs group hover:border-amber-500/30 transition-colors">
                                                      <img src={getPlayerAvatarUrl(user, 16)} alt="" className="w-3 h-3 rounded-sm" onError={(e) => { e.currentTarget.src = `https://crafthead.net/avatar/${user}/16`; }} />
                                                      <span className="text-neutral-300 font-medium">{user}</span>
                                                      <button
                                                         onClick={() => {
                                                            setGlobalSettings({
                                                               ...globalSettings,
                                                               defaultWhitelistUsers: globalSettings.defaultWhitelistUsers.filter(u => u !== user)
                                                            });
                                                         }}
                                                         className="text-neutral-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                                                      >
                                                         <X className="w-3 h-3 text-red-400" />
                                                      </button>
                                                   </div>
                                                ))
                                             )}
                                          </div>
                                       </div>
                                    </div>
                              </div>
                           </div>
                        )}

                        {settingsTab === "advanced" && (
                           <div className="space-y-8 animate-in slide-in-from-bottom-2 duration-300">
                              <div className="p-6 bg-amber-500/10 border border-amber-500/20 rounded-xl flex gap-4">
                                 <AlertCircle className="w-8 h-8 text-amber-500 flex-shrink-0" />
                                 <div className="space-y-2">
                                    <h3 className="text-amber-500 font-bold">Advanced Settings</h3>
                                    <p className="text-xs text-neutral-400 leading-relaxed">
                                       These settings can affect application stability and security.
                                       Only modify them if you know what you are doing.
                                    </p>
                                 </div>
                              </div>
                              <div className="space-y-4">
                                 <div className="flex flex-col gap-2">
                                    <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Docker Socket Path</label>
                                    <input
                                       type="text"
                                       value={globalSettings.dockerSocket || "/var/run/docker.sock"}
                                       onChange={(e) => setGlobalSettings({ ...globalSettings, dockerSocket: e.target.value })}
                                       className="w-full bg-[#141414] border border-[#333] p-3 rounded-lg focus:outline-none focus:border-[#3E8ED0] text-xs font-mono text-neutral-300"
                                    />
                                 </div>
                                 <button
                                     onClick={handleExportSystemLogs}
                                     className="w-full py-3 bg-[#333] hover:bg-[#3E8ED0]/20 text-[#3E8ED0] hover:text-white font-bold rounded-lg border border-[#444] hover:border-[#3E8ED0]/50 transition-all text-xs flex items-center justify-center gap-2">
                                    <FileText className="w-4 h-4" />
                                     EXPORT APPLICATION LOGS
                                 </button>
                              </div>
                           </div>
                        )}

                        {settingsTab === "updates" && (
                           <div className="space-y-8 animate-in slide-in-from-bottom-2 duration-300">
                              <div className="flex justify-between items-start">
                                 <div>
                                    <h3 className="text-lg font-bold mb-1">Updates</h3>
                                    <p className="text-sm text-neutral-500">Manage Isopod application updates.</p>
                                 </div>
                                 <button
                                    onClick={() => checkSystemUpdates(true)}
                                    disabled={isCheckingUpdates}
                                    className="p-2 hover:bg-[#333] rounded-lg transition-colors text-[#3E8ED0] disabled:opacity-50"
                                 >
                                    <RefreshCw className={`w-5 h-5 ${isCheckingUpdates ? 'animate-spin' : ''}`} />
                                 </button>
                              </div>

                              {updateInfo && (
                                 <div className="space-y-6">
                                    <div className="bg-[#242424] border border-[#3A3A3A] rounded-xl overflow-hidden shadow-sm">
                                       <div className="p-6 flex items-center justify-between bg-gradient-to-r from-[#242424] to-[#2A2A2A]">
                                          <div className="flex items-center gap-6">
                                             <div className="flex flex-col items-center">
                                                <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-1">Current</span>
                                                <div className="bg-[#1A1A1A] border border-[#333] px-4 py-2 rounded-lg font-mono text-xs font-bold text-neutral-400">{updateInfo.current_version}</div>
                                             </div>
                                             <ChevronRight className="w-5 h-5 text-neutral-700 mt-4" />
                                             <div className="flex flex-col items-center">
                                                <span className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${updateInfo.has_update ? 'text-emerald-500' : 'text-neutral-500'}`}>Latest</span>
                                                <div className={`px-4 py-2 rounded-lg font-mono text-xs font-bold border transition-all ${updateInfo.has_update ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : 'bg-[#1A1A1A] border-[#333] text-neutral-400'}`}>
                                                   {updateInfo.latest_version}
                                                </div>
                                             </div>
                                          </div>

                                          {updateInfo.has_update ? (
                                             <button
                                                onClick={performSystemUpdate}
                                                disabled={isUpdatingSystem}
                                                className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-bold text-sm shadow-xl shadow-emerald-500/10 transition-all flex items-center gap-2"
                                             >
                                                {isUpdatingSystem ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                                                Update Now
                                             </button>
                                          ) : (
                                             <div className="flex items-center gap-2 text-emerald-500 text-xs font-bold bg-emerald-500/10 px-4 py-2 rounded-lg border border-emerald-500/20">
                                                <Check className="w-4 h-4" /> Up to date
                                             </div>
                                          )}
                                       </div>

                                       {updateInfo.has_update && (
                                          <div className="p-6 border-t border-[#3A3A3A] bg-[#1E1E1E]">
                                             <div className="flex items-center gap-2 mb-4">
                                                <FileText className="w-4 h-4 text-[#3E8ED0]" />
                                                <h4 className="text-xs font-bold text-neutral-300 uppercase tracking-wider">Release Notes</h4>
                                             </div>
                                             <div className="bg-[#141414] border border-[#333] p-4 rounded-lg text-xs text-neutral-400 font-sans leading-relaxed whitespace-pre-wrap max-h-[200px] overflow-auto scrollbar-custom">
                                                {updateInfo.release_notes}
                                             </div>
                                             <div className="mt-4 flex items-center gap-2 text-[10px] text-neutral-600">
                                                <Globe className="w-3 h-3" /> Published on {new Date(updateInfo.published_at).toLocaleDateString()}
                                             </div>
                                          </div>
                                       )}
                                    </div>

                                    <div className="bg-[#3E8ED0]/5 border border-[#3E8ED0]/20 p-4 rounded-lg flex gap-3 items-start">
                                       <AlertCircle className="w-5 h-5 text-[#3E8ED0] mt-0.5" />
                                       <p className="text-[11px] text-neutral-500 leading-relaxed">
                                          Updates will preserve all your instance data, world files, and configurations. The application will experience a brief downtime while it restarts with the new version.
                                       </p>
                                    </div>
                                 </div>
                              )}

                              {!updateInfo && isCheckingUpdates && (
                                 <div className="flex flex-col items-center justify-center p-12 gap-4">
                                    <RefreshCw className="w-8 h-8 text-[#3E8ED0] animate-spin" />
                                    <span className="text-sm font-medium text-neutral-500">Retrieving update information...</span>
                                 </div>
                              )}
                           </div>
                        )}
                     </div>
                  </div>

                  {/* Footer */}
                  <div className="p-6 bg-[#2D2D2D] border-t border-[#3A3A3A] flex justify-between items-center px-8 shadow-inner">
                     <div className="flex items-center gap-3">
                        {JSON.stringify(globalSettings) !== originalGlobalSettings && (
                           <div className="flex items-center gap-2 text-amber-500 text-xs font-bold animate-pulse">
                              <AlertCircle className="w-4 h-4" />
                              UNSAVED CHANGES
                           </div>
                        )}
                     </div>
                     <div className="flex gap-3">
                        <button
                           onClick={() => {
                              if (JSON.stringify(globalSettings) !== originalGlobalSettings) {
                                 setGlobalSettings(JSON.parse(originalGlobalSettings));
                              }
                              setIsSettingsModalOpen(false);
                           }}
                           className="px-6 py-2.5 rounded-lg text-neutral-400 hover:bg-[#3A3A3A] hover:text-white font-bold transition-all text-sm"
                        >
                           {JSON.stringify(globalSettings) !== originalGlobalSettings ? "Discard Changes" : "Close"}
                        </button>
                        <button
                           onClick={handleSaveGlobalSettings}
                           disabled={isSavingGlobal || JSON.stringify(globalSettings) === originalGlobalSettings}
                           className={`px-8 py-2.5 rounded-lg flex items-center gap-2 font-bold transition-all shadow-xl text-sm ${JSON.stringify(globalSettings) === originalGlobalSettings
                                 ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed opacity-50 border border-neutral-700'
                                 : 'bg-[#3E8ED0] hover:bg-[#2B6A9E] text-white shadow-[#3E8ED0]/15'
                              }`}
                        >
                           {isSavingGlobal ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                           Save Settings
                        </button>
                     </div>
                  </div>
               </div>
            </div>
         )}
         {contextMenu && (
            <div
               className="fixed z-[1000] w-[220px] bg-[#2A2A2A] border border-[#3A3A3A] rounded-lg shadow-2xl py-1 animate-in fade-in zoom-in duration-150"
               style={{
                  top: contextMenu.y + 400 > window.innerHeight ? contextMenu.y - 400 : contextMenu.y,
                  left: contextMenu.x + 220 > window.innerWidth ? contextMenu.x - 220 : contextMenu.x
               }}
               onClick={(e) => e.stopPropagation()}
            >
               <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-500 uppercase tracking-widest border-b border-[#3A3A3A] mb-1 truncate">
                  {instances.find(i => i.id === contextMenu.instanceId)?.name || 'Instance'}
               </div>

               <button
                  onClick={() => { handleRename(contextMenu.instanceId); setContextMenu(null); }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm text-neutral-300 hover:bg-[#3E8ED0] hover:text-white transition-colors text-left"
               >
                  <Pencil className="w-4 h-4" /> Rename
               </button>
               <button
                  onClick={(e) => {
                     e.stopPropagation();
                     setPendingIconId(contextMenu.instanceId);
                     iconInputRef.current?.click();
                     setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm text-neutral-300 hover:bg-[#3E8ED0] hover:text-white transition-colors text-left"
               >
                  <Image className="w-4 h-4 text-sky-400" /> Change Icon
               </button>

               <div className="h-px bg-[#3A3A3A] my-1"></div>

               {(() => {
                  const isRunning = statuses[contextMenu.instanceId]?.is_running;
                  return (
                     <>
                        <button
                           disabled={isRunning}
                           onClick={(e) => { handleStart(contextMenu.instanceId, e as any); setContextMenu(null); }}
                           className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors text-left ${isRunning
                                 ? 'text-neutral-600 cursor-not-allowed opacity-40'
                                 : 'text-neutral-300 hover:bg-[#3E8ED0] hover:text-white'
                              }`}
                        >
                           <div className="flex items-center gap-3">
                              <Play className="w-4 h-4" /> Launch
                           </div>
                           <ChevronRight className="w-3.5 h-3.5 opacity-50" />
                        </button>
                        <button
                           disabled={!isRunning}
                           onClick={(e) => { handleStop(contextMenu.instanceId, e as any); setContextMenu(null); }}
                           className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors text-left ${!isRunning
                                 ? 'text-neutral-600 cursor-not-allowed opacity-40'
                                 : 'text-amber-500 hover:bg-amber-500 hover:text-white'
                              }`}
                           title={isRunning ? "Saves world first" : "Server is offline"}
                        >
                           <Square className="w-4 h-4" /> Stop (Safe)
                        </button>
                        <button
                           disabled={!isRunning}
                           onClick={(e) => { handleKill(contextMenu.instanceId, e as any); setContextMenu(null); }}
                           className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors text-left ${!isRunning
                                 ? 'text-neutral-600 cursor-not-allowed opacity-40'
                                 : 'text-red-400 hover:bg-red-600 hover:text-white'
                              }`}
                           title={isRunning ? "Force immediate stop" : "Server is offline"}
                        >
                           <X className="w-4 h-4" /> Kill (Unsafe)
                        </button>
                     </>
                  );
               })()}

               <div className="h-px bg-[#3A3A3A] my-1"></div>

               <button
                  onClick={() => { setSelectedId(contextMenu.instanceId); openEditModal(); setContextMenu(null); }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm text-neutral-300 hover:bg-[#3E8ED0] hover:text-white transition-colors text-left"
               >
                  <List className="w-4 h-4" /> Edit...
               </button>
               <button
                  onClick={() => { handleChangeGroup(contextMenu.instanceId); setContextMenu(null); }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm text-neutral-300 hover:bg-[#3E8ED0] hover:text-white transition-colors text-left"
               >
                  <Tag className="w-4 h-4 text-sky-400" /> Change Group...
               </button>
               <button
                  onClick={() => {
                     setIsGlobalBrowser(false);
                     setIsEditModalOpen(true);
                     setEditTab("files");
                     fetchFileList(contextMenu.instanceId);
                     setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm text-neutral-300 hover:bg-[#3E8ED0] hover:text-white transition-colors text-left"
               >
                  <Folder className="w-4 h-4" /> Folder
               </button>
               <button
                  onClick={() => { handleExport(contextMenu.instanceId); setContextMenu(null); }}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-neutral-300 hover:bg-[#3E8ED0] hover:text-white transition-colors text-left"
               >
                  <div className="flex items-center gap-3">
                     <Share className="w-4 h-4" /> Export...
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 opacity-50" />
               </button>
               <button
                  onClick={() => { handleDuplicate(contextMenu.instanceId); setContextMenu(null); }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm text-neutral-300 hover:bg-[#3E8ED0] hover:text-white transition-colors text-left"
               >
                  <Copy className="w-4 h-4" /> Duplicate
               </button>
               <button
                  onClick={() => { handleDelete(contextMenu.instanceId); setContextMenu(null); }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-400 hover:bg-red-500 hover:text-white transition-colors text-left"
               >
                  <Trash2 className="w-4 h-4" /> Delete
               </button>
            </div>
         )}
         {dialog && (
            <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
               <div className="bg-[#2A2A2A] border border-[#3A3A3A] rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in duration-200">
                  <div className="px-6 py-4 border-b border-[#323232] bg-[#242424] flex items-center gap-3 shrink-0">
                     {dialog.type === 'alert' && <AlertCircle className="w-5 h-5 text-amber-500" />}
                     {dialog.type === 'confirm' && <HelpCircle className="w-5 h-5 text-[#3E8ED0]" />}
                     {dialog.type === 'prompt' && <Edit className="w-5 h-5 text-[#3E8ED0]" />}
                     <h3 className="font-bold text-white tracking-wide uppercase text-[10px]">{dialog.title}</h3>
                  </div>
                  <div className="p-6 overflow-y-auto max-h-[60vh] scrollbar-custom">
                     <p className="text-neutral-300 text-sm leading-relaxed mb-4 whitespace-pre-wrap break-words">{dialog.message}</p>
                     {dialog.type === 'prompt' && (
                        <input
                           autoFocus
                           id="dialog-input"
                           type="text"
                           defaultValue={dialog.defaultValue}
                           onKeyDown={(e) => {
                              if (e.key === 'Enter') dialog.onResult(e.currentTarget.value);
                              if (e.key === 'Escape') dialog.onResult(null);
                           }}
                           className="w-full bg-[#1A1A1A] border border-[#3A3A3A] px-3 py-2 rounded text-white focus:outline-none focus:border-[#3E8ED0] text-sm"
                        />
                     )}
                     {dialog.type === 'select' && (
                        <select
                           autoFocus
                           id="dialog-select"
                           defaultValue={dialog.defaultValue || (dialog.options?.[0] || "")}
                           onKeyDown={(e) => {
                              if (e.key === 'Enter') dialog.onResult(e.currentTarget.value);
                              if (e.key === 'Escape') dialog.onResult(null);
                           }}
                           className="w-full bg-[#1A1A1A] border border-[#3A3A3A] px-3 py-2 rounded text-white focus:outline-none focus:border-[#3E8ED0] text-sm"
                        >
                           {dialog.options?.map((opt) => (
                              <option key={opt} value={opt} className="bg-[#2A2A2A] text-white">
                                 {opt}
                              </option>
                           ))}
                        </select>
                     )}
                  </div>
                  <div className="px-6 py-4 bg-[#242424] border-t border-[#323232] flex justify-end gap-3">
                     {(dialog.type === 'confirm' || dialog.type === 'prompt' || dialog.type === 'select') && (
                        <button
                           onClick={() => dialog.onResult(null)}
                           className="px-4 py-2 text-[10px] font-bold text-neutral-400 hover:text-white transition-colors uppercase tracking-widest"
                        >
                           Cancel
                        </button>
                     )}
                     <button
                        autoFocus={dialog.type !== 'prompt' && dialog.type !== 'select'}
                        onClick={() => {
                           if (dialog.type === 'prompt') {
                              const input = document.getElementById('dialog-input') as HTMLInputElement;
                              dialog.onResult(input?.value || "");
                           } else if (dialog.type === 'select') {
                              const select = document.getElementById('dialog-select') as HTMLSelectElement;
                              dialog.onResult(select?.value || "");
                           } else {
                              dialog.onResult(true);
                           }
                        }}
                        className="px-6 py-2 bg-[#3E8ED0] hover:bg-[#2B6A9E] text-white font-bold rounded text-[10px] transition-all shadow-lg shadow-[#3E8ED0]/15 uppercase tracking-widest"
                     >
                        OK
                     </button>
                  </div>
               </div>
            </div>
         )}
         {isExportModalOpen && (
            <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
               <div className="bg-[#2A2A2A] border border-[#3A3A3A] rounded-lg shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
                  <div className="px-6 py-4 border-b border-[#323232] bg-[#242424] flex items-center justify-between">
                     <div className="flex items-center gap-2">
                        <Share className="w-5 h-5 text-sky-400" />
                        <h3 className="font-bold text-white tracking-wide uppercase text-[10px] tracking-widest">Export Instance</h3>
                     </div>
                     <button
                        onClick={() => setIsExportModalOpen(false)}
                        className="p-1 hover:bg-[#323232] rounded-full text-neutral-400 hover:text-white transition"
                     >
                        <X className="w-4 h-4" />
                     </button>
                  </div>
                  <div className="p-6 flex flex-col gap-4">
                     <p className="text-neutral-300 text-sm leading-relaxed">
                        Select the components you want to include in the backup zip for <strong className="text-white">{instances.find(i => i.id === exportInstanceId)?.name}</strong>:
                     </p>

                     <div className="flex flex-col gap-3">
                        <label className="flex items-start gap-3 p-3 bg-[#202020] hover:bg-[#252525] rounded-lg border border-[#333] cursor-pointer transition select-none">
                           <input
                              type="checkbox"
                              checked={exportWorld}
                              onChange={(e) => setExportWorld(e.target.checked)}
                              className="mt-1 accent-sky-500 rounded border-neutral-600 focus:ring-sky-500"
                           />
                           <div className="ml-3">
                              <div className="text-sm font-semibold text-neutral-200">World Files</div>
                              <div className="text-xs text-neutral-400">Includes Overworld, Nether, and End dimensions.</div>
                           </div>
                        </label>

                        <label className="flex items-start gap-3 p-3 bg-[#202020] hover:bg-[#252525] rounded-lg border border-[#333] cursor-pointer transition select-none">
                           <input
                              type="checkbox"
                              checked={exportConfigs}
                              onChange={(e) => setExportConfigs(e.target.checked)}
                              className="mt-1 accent-sky-500 rounded border-neutral-600 focus:ring-sky-500"
                           />
                           <div className="ml-3">
                              <div className="text-sm font-semibold text-neutral-200">Configurations & Settings</div>
                              <div className="text-xs text-neutral-400">Includes server.properties, compose files, and mod configs.</div>
                           </div>
                        </label>

                        <label className="flex items-start gap-3 p-3 bg-[#202020] hover:bg-[#252525] rounded-lg border border-[#333] cursor-pointer transition select-none">
                           <input
                              type="checkbox"
                              checked={exportMods}
                              onChange={(e) => setExportMods(e.target.checked)}
                              className="mt-1 accent-sky-500 rounded border-neutral-600 focus:ring-sky-500"
                           />
                           <div className="ml-3">
                              <div className="text-sm font-semibold text-neutral-200">Mods</div>
                              <div className="text-xs text-neutral-400">Includes Fabric/Forge jar files from the mods folder.</div>
                           </div>
                        </label>

                        <label className="flex items-start gap-3 p-3 bg-[#202020] hover:bg-[#252525] rounded-lg border border-[#333] cursor-pointer transition select-none">
                           <input
                              type="checkbox"
                              checked={exportPlugins}
                              onChange={(e) => setExportPlugins(e.target.checked)}
                              className="mt-1 accent-sky-500 rounded border-neutral-600 focus:ring-sky-500"
                           />
                           <div className="ml-3">
                              <div className="text-sm font-semibold text-neutral-200">Plugins</div>
                              <div className="text-xs text-neutral-400">Includes Spigot/Paper server plugins.</div>
                           </div>
                        </label>

                        <label className="flex items-start gap-3 p-3 bg-[#202020] hover:bg-[#252525] rounded-lg border border-[#333] cursor-pointer transition select-none">
                           <input
                              type="checkbox"
                              checked={exportLogs}
                              onChange={(e) => setExportLogs(e.target.checked)}
                              className="mt-1 accent-sky-500 rounded border-neutral-600 focus:ring-sky-500"
                           />
                           <div className="ml-3">
                              <div className="text-sm font-semibold text-neutral-200">Server Logs</div>
                              <div className="text-xs text-neutral-400">Includes historical console logs (can be very large).</div>
                           </div>
                        </label>
                     </div>
                  </div>
                  <div className="px-6 py-4 bg-[#242424] border-t border-[#323232] flex justify-end gap-3">
                     <button
                        onClick={() => setIsExportModalOpen(false)}
                        className="px-4 py-2 text-[10px] font-bold text-neutral-400 hover:text-white transition-colors uppercase tracking-widest"
                     >
                        Cancel
                     </button>
                     <button
                        onClick={handleExportSubmit}
                        className="px-6 py-2 bg-sky-500 hover:bg-sky-600 text-white font-bold rounded text-[10px] transition-all shadow-lg shadow-sky-500/15 uppercase tracking-widest flex items-center gap-2"
                     >
                        <Share className="w-3.5 h-3.5" /> Export
                     </button>
                  </div>
               </div>
            </div>
         )}
         <input
            type="file"
            ref={iconInputRef}
            className="hidden"
            accept="image/*"
            onChange={handleIconUpload}
         />
         <input
            type="file"
            ref={newIconInputRef}
            className="hidden"
            accept="image/*"
            onChange={(e) => {
               if (e.target.files?.[0]) setNewIconFile(e.target.files[0]);
               e.target.value = "";
            }}
         />

         {/* System Update Progress Overlay Modal */}
         {updateProgressState && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-md animate-in fade-in duration-200 select-none p-4">
               <div className="bg-[#1E1E1E] border border-[#383838] rounded-2xl p-8 max-w-lg w-full shadow-2xl space-y-6 text-center animate-in zoom-in-95 duration-200">
                  {/* Status Icon */}
                  <div className="flex justify-center">
                     {updateProgressState.stage === "success" ? (
                        <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-[0_0_25px_rgba(16,185,129,0.25)] animate-in zoom-in duration-300">
                           <Check className="w-8 h-8" />
                        </div>
                     ) : updateProgressState.stage === "error" ? (
                        <div className="w-16 h-16 rounded-full bg-amber-500/20 border-2 border-amber-500/40 flex items-center justify-center text-amber-400 shadow-[0_0_25px_rgba(245,158,11,0.25)]">
                           <AlertCircle className="w-8 h-8" />
                        </div>
                     ) : (
                        <div className="w-16 h-16 rounded-full bg-[#3E8ED0]/20 border-2 border-[#3E8ED0]/40 flex items-center justify-center text-[#3E8ED0] shadow-[0_0_25px_rgba(62,142,208,0.25)]">
                           <RefreshCw className="w-8 h-8 animate-spin" />
                        </div>
                     )}
                  </div>

                  {/* Title and Message */}
                  <div className="space-y-2">
                     <h3 className="text-xl font-bold text-white tracking-tight">
                        {updateProgressState.stage === "success"
                           ? "Update Completed!"
                           : updateProgressState.stage === "error"
                           ? "Update Notice"
                           : "Updating Isopod..."}
                     </h3>
                     <p className="text-xs text-neutral-300 leading-relaxed font-medium">
                        {updateProgressState.message}
                     </p>
                  </div>

                  {/* Animated Progress Bar */}
                  <div className="space-y-2 pt-2">
                     <div className="w-full h-3.5 bg-[#141414] border border-[#333] rounded-full overflow-hidden p-0.5 relative shadow-inner">
                        <div
                           className={`h-full rounded-full transition-all duration-500 ease-out ${
                              updateProgressState.stage === "success"
                                 ? "bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]"
                                 : updateProgressState.stage === "error"
                                 ? "bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.5)]"
                                 : "bg-gradient-to-r from-[#3E8ED0] to-emerald-400 shadow-[0_0_15px_rgba(62,142,208,0.5)]"
                           }`}
                           style={{ width: `${Math.max(5, Math.min(100, updateProgressState.progress))}%` }}
                        />
                     </div>
                     <div className="flex justify-between items-center text-[10px] text-neutral-400 px-1 font-mono">
                        <span className="capitalize text-neutral-400">
                           {updateProgressState.stage === "initiating" && "Step 1 of 3: Requesting update..."}
                           {updateProgressState.stage === "rebuilding" && "Step 2 of 3: Rebuilding container..."}
                           {updateProgressState.stage === "waiting_reconnect" && "Step 3 of 3: Restarting services..."}
                           {updateProgressState.stage === "success" && "Finalizing: Ready"}
                           {updateProgressState.stage === "error" && "Notice"}
                        </span>
                        <span className="font-bold text-neutral-200">
                           {Math.round(updateProgressState.progress)}%
                        </span>
                     </div>
                  </div>

                  {/* Error Details & Recovery Actions */}
                  {updateProgressState.stage === "error" && (
                     <div className="space-y-4 animate-in fade-in duration-200">
                        {updateProgressState.errorDetails && (
                           <div className="bg-[#161616] border border-[#333] p-3 rounded-lg text-left text-[11px] text-neutral-400 font-mono leading-relaxed max-h-28 overflow-auto scrollbar-custom">
                              {updateProgressState.errorDetails}
                           </div>
                        )}
                        <div className="flex justify-center gap-3 pt-2">
                           <button
                              onClick={() => setUpdateProgressState(null)}
                              className="px-4 py-2 bg-[#2D2D2D] hover:bg-[#383838] text-neutral-300 rounded-lg text-xs font-semibold transition"
                           >
                              Dismiss
                           </button>
                           <button
                              onClick={() => window.location.reload()}
                              className="px-5 py-2 bg-[#3E8ED0] hover:bg-[#347ab5] text-white rounded-lg text-xs font-bold transition shadow-lg shadow-[#3E8ED0]/20 flex items-center gap-2"
                           >
                              <RefreshCw className="w-3.5 h-3.5" /> Reload Page
                           </button>
                        </div>
                     </div>
                  )}

                  {/* Safety note */}
                  {updateProgressState.stage !== "error" && (
                     <p className="text-[10px] text-neutral-400 pt-2 border-t border-[#2A2A2A]">
                        Please keep this browser window open while Isopod updates. All server instances and data remain safe.
                     </p>
                  )}
               </div>
            </div>
         )}

         {/* Post-Update Success Toast */}
         {updateSuccessToast && (
            <div className="fixed bottom-6 right-6 z-[90] bg-emerald-950/95 border border-emerald-500/40 text-emerald-100 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-5 fade-in duration-300 backdrop-blur-md">
               <div className="w-7 h-7 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                  <Check className="w-4 h-4" />
               </div>
               <div className="flex flex-col pr-2">
                  <span className="text-xs font-bold text-white">System Updated</span>
                  <span className="text-[11px] text-emerald-300/80">{updateSuccessToast}</span>
               </div>
               <button
                  onClick={() => setUpdateSuccessToast(null)}
                  className="p-1 hover:bg-emerald-800/40 rounded text-emerald-400/60 hover:text-white transition"
               >
                  <X className="w-4 h-4" />
               </button>
            </div>
         )}
      </div>

   );
}
