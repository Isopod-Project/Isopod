import React, { useEffect, useState, useRef } from "react";
import { Folder, Play, Square, Settings, Plus, RefreshCw, Layers, Gamepad2, AlertCircle, Edit, Trash2, Database, Cpu, Box, Terminal, X, Search, Check, ExternalLink, Save, ChevronRight, FileText, ArrowLeft, Monitor, Shield, Sun, Moon, Languages, Users, Pencil, Tag, Copy, List, Share, HelpCircle, Globe, Image, ArrowDown } from "lucide-react";

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
  const [isVerbose, setIsVerbose] = useState(false);

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPort, setNewPort] = useState("25565");
  const [isCreating, setIsCreating] = useState(false);
  
  // Prism-like Add Modal States
  const [addStep, setAddStep] = useState<number>(1);
  const [addTab, setAddTab] = useState<"custom" | "import" | "modrinth" | "curseforge" | "atlauncher" | "technic" | "world">("custom");
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

  // Edit Modal states
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editTab, setEditTab] = useState("logs");
  const [serverLogs, setServerLogs] = useState<Record<string, string>>({});
  const [manualLogs, setManualLogs] = useState<Record<string, { anchor: string, content: string }[]>>({});
  const [isLogsLoading, setIsLogsLoading] = useState(false);
  // Instance Config States
  const [config, setConfig] = useState<{image: string, environment: Record<string, string>}>({image: "", environment: {}});
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
  const [modSearchProvider, setModSearchProvider] = useState<"modrinth" | "curseforge">("modrinth");
  const [modSearchResults, setModSearchResults] = useState<any[]>([]);
  const [isModSearching, setIsModSearching] = useState(false);
  const [modSearchVersion, setModSearchVersion] = useState("");
  const [modSearchLoader, setModSearchLoader] = useState("");
  const [modListView, setModListView] = useState<"list" | "search">("list");
  const [installedModsMeta, setInstalledModsMeta] = useState<any[]>([]);
  const [isMetaLoading, setIsMetaLoading] = useState(false);
  const [consoleCommand, setConsoleCommand] = useState("");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [isExecuting, setIsExecuting] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const scrollRef = useRef<HTMLPreElement>(null);
  
  // Version Change Handling
  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false);
  const [pendingVersion, setPendingVersion] = useState("");
  const [updateLoader, setUpdateLoader] = useState(true);
  const [updateMods, setUpdateMods] = useState(true);
  const [isCheckingCompatibility, setIsCheckingCompatibility] = useState(false);
  const [compatibility, setCompatibility] = useState<{compatible: any[], incompatible: any[]}>({compatible: [], incompatible: []});
  
  // File Browser States
  const [fileList, setFileList] = useState<any[]>([]);
  const [currentFilePath, setCurrentFilePath] = useState(".");
  const [isFilesLoading, setIsFilesLoading] = useState(false);
  const [viewingFile, setViewingFile] = useState<{name: string, content: string} | null>(null);
  const [isGlobalBrowser, setIsGlobalBrowser] = useState(false);
  
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
     defaultWhitelistUsers: [] as string[]
  });
  const [originalGlobalSettings, setOriginalGlobalSettings] = useState("");
  const [isSavingGlobal, setIsSavingGlobal] = useState(false);
  const [seenPlayers, setSeenPlayers] = useState<{name: string, uuid: string}[]>([]);
  const [newWhitelistUser, setNewWhitelistUser] = useState("");
  const [whitelistPreview, setWhitelistPreview] = useState<{name: string, uuid: string} | null>(null);
  const [isVerifyingUser, setIsVerifyingUser] = useState(false);
  
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [instanceWhitelistUser, setInstanceWhitelistUser] = useState("");
  const [instanceWhitelistPreview, setInstanceWhitelistPreview] = useState<{name: string, uuid: string} | null>(null);

  // User Management Tab States
  interface InstanceUser {
    name: string;
    uuid?: string;
    level: number;
    is_op: boolean;
    whitelisted: boolean;
  }
  const [instanceUsers, setInstanceUsers] = useState<InstanceUser[]>([]);
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [isUsersSaving, setIsUsersSaving] = useState(false);
  const [userSearchText, setUserSearchText] = useState("");
  const [userSearchPreview, setUserSearchPreview] = useState<{name: string, uuid: string} | null>(null);
  const [isUserSearchVerifying, setIsUserSearchVerifying] = useState(false);

  // Resource Pack States
  const [resourcePackQuery, setResourcePackQuery] = useState("");
  const [resourcePackProvider, setResourcePackProvider] = useState<"modrinth" | "curseforge">("modrinth");
  const [resourcePackResults, setResourcePackResults] = useState<any[]>([]);
  const [isResourcePackSearching, setIsResourcePackSearching] = useState(false);
  const [resourcePackListView, setResourcePackListView] = useState<"list" | "search">("list");
  const [installedResourcePacksMeta, setInstalledResourcePacksMeta] = useState<any[]>([]);
  const [isResourcePackMetaLoading, setIsResourcePackMetaLoading] = useState(false);

  // Bootstrap seenPlayers with defaults and common entries
  useEffect(() => {
    const defaults = globalSettings.defaultWhitelistUsers.map(u => ({ name: u, uuid: u }));
    const common = [
       { name: "Technoblade", uuid: "ad8b121c-a330-4c8d-83c3-6311ce833c94" },
       { name: "Dream", uuid: "ec70bc6c-7023-4402-847c-c0494426545b" },
       { name: "TheTacomin", uuid: "8696c21e-7b7e-400a-b50a-f02755e1136c" }
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

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setIsCreating(true);
      try {
         const formData = new FormData();
         formData.append("file", file);
         const res = await fetch("/api/instances/import", { method: "POST", body: formData });
         if (res.ok) {
            const data = await res.json();
            await fetchInstances();
            setSelectedId(data.id);
            setIsAddModalOpen(false);
            await showAlert("Instance imported successfully!", "Success");
         } else {
            const err = await res.json().catch(() => ({}));
            await showAlert(`Failed to import: ${err.detail || 'Server error'}`, "Error");
         }
      } catch (err) {
         await showAlert("Error uploading instance zip.", "Error");
      } finally {
         setIsCreating(false);
         if (e.target) e.target.value = '';
      }
  };

  const handleStart = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setStatuses((prev: Record<string, InstanceStatus>) => ({
        ...prev, 
        [id]: { ...prev[id], is_running: true } // Optimistic update
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
        [id]: { ...prev[id], is_running: false } // Optimistic update
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
        [id]: { ...prev[id], is_running: false, is_ready: false } // Optimistic update
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
      const body: any = { 
        name: newName, 
        template: selectedAddLoader.toLowerCase(), 
        port: parseInt(newPort),
        version: selectedAddVersion === 'latest' ? '' : selectedAddVersion,
        loader_version: selectedAddLoaderVersion,
        modrinth_id: addTab === 'modrinth' && selectedModpack ? selectedModpack.id : null,
        cf_id: addTab === 'curseforge' && selectedModpack ? selectedModpack.id : null,
        modpack_version: (addTab === 'modrinth' || addTab === 'curseforge') && selectedModpack ? selectedModpackVersion : null,
        seed: newSeed,
        level_type: newLevelType,
        difficulty: newDifficulty,
        gamemode: newGamemode,
        generate_structures: newGenerateStructures,
        memory: newMemory
      };

      const res = await fetch("/api/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error("Failed to create instance");
      const data = await res.json();

      setInstances((prev: Instance[]) => [...prev, data]);
      setIsAddModalOpen(false);
      
      // Reset states
      setNewName("");
      setSelectedModpack(null);
      setModpackVersions([]);
      setSelectedModpackVersion("");
      setSelectedAddVersion("latest");
      setSelectedAddLoader("VANILLA");
      setSelectedAddLoaderVersion("latest");
      setNewSeed("");
      setNewLevelType("DEFAULT");
      setNewDifficulty("easy");
      setNewGamemode("survival");
      setNewGenerateStructures(true);
      setNewMemory(globalSettings.defaultMemory);
      
      fetchInstances();
    } catch (e) {
      console.error(e);
      await showAlert("Failed to create instance", "Creation Failed");
    } finally {
      setIsCreating(false);
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
         } catch (e) {}
      }
  };

  const handleDeleteGroup = async (groupName: string) => {
      if (groupName === "No group") return;
      const confirmed = await showConfirm(`Are you sure you want to remove the group "${groupName}"?`, "Remove Group");
      if (!confirmed) return;
      try {
         const res = await fetch(`/api/groups/${encodeURIComponent(groupName)}`, { method: "DELETE" });
         if (res.ok) { await fetchInstances(); await fetchGroups(); }
      } catch (e) {}
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
    } catch (e) {
      console.error("Failed to fetch config", e);
    }
  };

  const fetchInstanceUsers = async (id: string) => {
    setIsUsersLoading(true);
    try {
      const res = await fetch(`/api/instances/${id}/users`);
      if (res.ok) {
        const data = await res.json();
        setInstanceUsers(data);
      }
    } catch (e) {
      console.error("Failed to fetch instance users", e);
    } finally {
      setIsUsersLoading(false);
    }
  };

  const saveInstanceUsers = async (id: string) => {
    setIsUsersSaving(true);
    try {
      const res = await fetch(`/api/instances/${id}/users`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(instanceUsers)
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
                       uuid: data.data.player.raw_id 
                    };
                    setUserSearchPreview(p);
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
            [id]: { ...prev[id], is_running: false, is_ready: false }
         }));
         // We use stop then start for a clean reload of compose
         await fetch(`/api/instances/${id}/stop`, { method: "POST" });
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

  const handleVersionClick = async (vId: string) => {
    if (vId === config.environment["VERSION"]) return;
    
    setPendingVersion(vId);
    setIsVersionModalOpen(true);
    setIsCheckingCompatibility(true);
    setCompatibility({compatible: [], incompatible: []});

    try {
      const loader = config.environment["TYPE"] || "VANILLA";
      const modrinthIds = (config.environment["MODRINTH_PROJECTS"] || "").split(',').filter(Boolean);
      const cfIds = (config.environment["CF_PROJECTS"] || "").split(',').filter(Boolean);

      const res = await fetch("/api/mods/check-compatibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mc_version: vId,
          loader: loader,
          modrinth_ids: modrinthIds,
          cf_ids: cfIds
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

  const applyVersionChange = () => {
    const newEnv = { ...config.environment };
    newEnv["VERSION"] = pendingVersion;
    
    if (updateMods) {
        // Keep only compatible ones
        const compModrinth = compatibility.compatible.filter((m: any) => m.provider === 'modrinth').map((m: any) => m.id);
        const compCf = compatibility.compatible.filter((m: any) => m.provider === 'curseforge').map((m: any) => m.id);
        
        newEnv["MODRINTH_PROJECTS"] = compModrinth.join(',');
        newEnv["CF_PROJECTS"] = compCf.join(',');
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

  const handleModSearch = async (query: string, provider: string, forceVersion?: string, forceLoader?: string) => {
    setIsModSearching(true);
    try {
      // Default to what's in the search inputs, or fallback to instance configuration
      let mc_version = forceVersion !== undefined ? forceVersion : (modSearchVersion || (config?.environment ? (config.environment["VERSION"] || "") : ""));
      let raw_loader = forceLoader !== undefined ? forceLoader : (modSearchLoader || (config?.environment ? (config.environment["TYPE"] || "") : ""));
      
      // Fix potential "undefined" literals
      if (mc_version === "undefined") mc_version = "";
      if (raw_loader === "undefined") raw_loader = "";

      const res = await fetch(`/api/mods/search/${provider}?q=${encodeURIComponent(query)}&mc_version=${mc_version}&loader=${raw_loader}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setModSearchResults(data);
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
      const cIdsEnv = config.environment["CF_PROJECTS"] || "";
      const modrinthModpack = config.environment["MODRINTH_MODPACK"] || "";
      const cfModpack = config.environment["CF_SLUG"] || "";

      if (!mIdsEnv && !cIdsEnv && !modrinthModpack && !cfModpack) {
         setInstalledModsMeta([]);
         return;
      }

      setIsMetaLoading(true);
      try {
         const res = await fetch(`/api/mods/metadata?modrinth_ids=${mIdsEnv}&cf_ids=${cIdsEnv}&modrinth_modpack=${modrinthModpack}&cf_modpack=${cfModpack}`);
         const data = await res.json();
         setInstalledModsMeta(data);

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
      const confirmed = await showConfirm("This will update Isopod to the latest version and restart the application. All your instance data is safe. Proceed?", "Update Isopod");
      if (!confirmed) return;

      setIsUpdatingSystem(true);
      try {
         const res = await fetch("/api/system/update", { method: "POST" });
         const data = await res.json();
         await showAlert(data.message, "Update Started");
         // Reload after a delay
         setTimeout(() => window.location.reload(), 5000);
      } catch (e) {
         await showAlert("Failed to start update", "Error");
      } finally {
         setIsUpdatingSystem(false);
      }
   };

   const addWithDependencies = async (res: any, provider: string) => {
      const envKey = provider === 'modrinth' ? "MODRINTH_PROJECTS" : "CF_PROJECTS";
      const currentList: string = config.environment[envKey] || "";
      const ids = currentList.split(',').map(s => s.trim()).filter(Boolean);

      if (ids.includes(res.id)) return;

      try {
         // Fetch dependencies
         const depRes = await fetch(`/api/mods/dependencies?provider=${provider}&project_id=${res.id}`);
         const depIds: string[] = await depRes.json();

         const toAdd = [res.id, ...depIds];
         const newIds = [...new Set([...ids, ...toAdd])].join(',');

         setConfig(prev => ({
            ...prev,
            environment: { ...prev.environment, [envKey]: newIds }
         }));
      } catch (e) {
         console.error("Failed to fetch dependencies", e);
         // Fallback: just add the mod itself
         const newList = currentList ? `${currentList},${res.id}` : res.id;
         setConfig(prev => ({
            ...prev,
            environment: { ...prev.environment, [envKey]: newList }
         }));
      }
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
            setNewMemory(data.defaultMemory || "1G");
         }
      } catch (e) {
         console.error("Failed to fetch settings", e);
      }
   };

   const handleSaveGlobalSettings = async () => {
      setIsSavingGlobal(true);
      try {
         const res = await fetch("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(globalSettings)
         });
         if (!res.ok) throw new Error("Failed to save settings");
         setOriginalGlobalSettings(JSON.stringify(globalSettings));
      } catch (e) {
         console.error(e);
         await showAlert("Failed to save global settings", "Error");
      } finally {
         setIsSavingGlobal(false);
      }
   };

   useEffect(() => {
      if (autoScrollEnabled && scrollRef.current) {
         scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
   }, [serverLogs, manualLogs, editTab, autoScrollEnabled]);

   useEffect(() => {
      fetchInstances();
      fetchMcVersions();
      fetchGlobalSettings();
      checkSystemUpdates();
   }, []);

   useEffect(() => {
      if (!globalSettings.autoRefresh) return;
      const interval = setInterval(() => {
         instances.forEach((inst: Instance) => fetchStatus(inst.id));
      }, 5000);
      return () => clearInterval(interval);
   }, [instances, globalSettings.autoRefresh]);

   // Live Logs Polling
   useEffect(() => {
      let interval: any;
      if (isEditModalOpen && editTab === "logs" && selectedId) {
         interval = setInterval(() => {
            if (!isLogsLoading) {
               fetchLogs(selectedId);
            }
         }, 3000);
      }
      return () => interval && clearInterval(interval);
   }, [isEditModalOpen, editTab, selectedId, isLogsLoading, fetchLogs]);

   // Sync mod search filters when config is loaded
   useEffect(() => {
      if (isEditModalOpen && config.environment) {
         const v = config.environment["VERSION"] || "";
         const l = config.environment["TYPE"] || "";
         setModSearchVersion(v);
         setModSearchLoader(l);
         fetchInstalledModsMeta();
         fetchInstalledResourcePacksMeta();
         // Auto-browse when opening search
         handleModSearch("", modSearchProvider, v, l);
         handleResourcePackSearch("", resourcePackProvider);
      }
   }, [isEditModalOpen, config.environment]);

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
      if (isAddModalOpen && addTab === "modrinth" && searchModpacks) {
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

   // Verify Minecraft User for Instance Whitelist
   useEffect(() => {
      const timer = setTimeout(async () => {
         if (instanceWhitelistUser.length >= 3) {
            try {
               const res = await fetch(`https://playerdb.co/api/player/minecraft/${instanceWhitelistUser}`);
               const data = await res.json();
               if (data.success) {
                  const p = { name: data.data.player.username, uuid: data.data.player.id };
                  setInstanceWhitelistPreview(p);
                  setSeenPlayers(prev => {
                     if (prev.find(x => x.uuid === p.uuid)) return prev;
                     return [...prev, p].slice(-20);
                  });
               } else {
                  setInstanceWhitelistPreview(null);
               }
            } catch (e) { setInstanceWhitelistPreview(null); }
         } else {
            setInstanceWhitelistPreview(null);
         }
      }, 600);
      return () => clearTimeout(timer);
   }, [instanceWhitelistUser]);

   const selectedInstance = instances.find(i => i.id === selectedId);
   const selectedStatus = selectedId ? statuses[selectedId] : null;
   const logs = selectedId ? (serverLogs[selectedId] || "") : "";

  // Fetch loader versions when selection changes
  useEffect(() => {
    if (isAddModalOpen && selectedAddLoader !== "VANILLA") {
       // Only fetch if we have an actual version ID or 'latest'
       const versionToFetch = selectedAddVersion === "latest" ? "" : selectedAddVersion;
       fetchLoaderVersions(selectedAddLoader, versionToFetch);
    } else {
       setLoaderVersions([]);
    }
  }, [selectedAddLoader, selectedAddVersion, isAddModalOpen]);


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
                setAddStep(1);
                setAddTab("custom");
                setNewName("");
                setSelectedAddVersion("latest");
                setSelectedAddLoader("VANILLA");
                setSelectedModpack(null);
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
                             className={`flex flex-col items-center justify-center p-3 rounded cursor-pointer transition-all w-[110px] select-none ${
                               isSelected 
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
                               <div className={`absolute bottom-1 right-1 w-3 h-3 rounded-full border-2 border-[#3B3B3B] ${
                                  isRunning 
                                  ? (statuses[inst.id]?.is_ready ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse') 
                                  : 'bg-neutral-500'
                               }`}></div>
                             </div>
                             <span className="text-xs text-center font-medium line-clamp-2 leading-tight">
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
                             className={`flex flex-col items-center justify-center p-3 rounded cursor-pointer transition-all w-[110px] select-none ${
                               isSelected 
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
                               <div className={`absolute bottom-1 right-1 w-3 h-3 rounded-full border-2 border-[#3B3B3B] ${
                                  isRunning 
                                  ? (statuses[inst.id]?.is_ready ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse') 
                                  : 'bg-neutral-500'
                               }`}></div>
                             </div>
                             <span className="text-xs text-center font-medium line-clamp-2 leading-tight">
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
              <h2 className="text-lg font-bold text-center leading-tight mb-1">{selectedInstance.name}</h2>
              <p className="text-xs text-neutral-400">
                 {!selectedStatus?.is_running ? 'Offline' : (selectedStatus?.is_ready ? 'Online' : 'Starting...')}
              </p>
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
                      <span className="text-neutral-500 uppercase font-bold tracking-wider">Address</span>
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
              <div className="w-16 h-16 bg-[#3B3B3B] rounded flex items-center justify-center shadow-inner relative group border border-[#444]">
                 {selectedModpack?.icon_url ? <img src={selectedModpack.icon_url} className="w-full h-full object-cover rounded" /> : <Gamepad2 className="w-8 h-8 text-neutral-600" />}
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
                        { id: "atlauncher", name: "ATLauncher", icon: Box },
                        { id: "curseforge", name: "CurseForge", icon: Settings },
                        { id: "modrinth", name: "Modrinth", icon: RefreshCw },
                        { id: "technic", name: "Technic", icon: Layers }
                     ].map((tab) => (
                        <button 
                           key={tab.id}
                           onClick={() => {
                              setAddTab(tab.id as any);
                              if (tab.id === 'modrinth' || tab.id === 'curseforge') {
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
                                       {['VANILLA', 'FABRIC', 'FORGE', 'NEOFORGE', 'QUILT', 'PAPER', 'SPIGOT'].map(l => (
                                          <button 
                                             key={l}
                                             onClick={() => setSelectedAddLoader(l)}
                                             className={`px-3 py-1 rounded text-[10px] font-bold transition-all flex-shrink-0 ${selectedAddLoader === l ? 'bg-[#3E8ED0] text-white shadow-md' : 'text-neutral-500 hover:text-white'}`}
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
                                 <h3 className="text-xl font-bold text-white">Import Existing Server</h3>
                                 <p className="text-sm text-neutral-400 max-w-sm">Place your server files in a folder within your servers directory, then select it here to begin configuration.</p>
                              </div>
                              <label className="px-8 py-3 bg-[#333] hover:bg-[#444] rounded-lg font-bold text-white transition-all cursor-pointer">
                                  Browse Zip File
                                  <input type="file" className="hidden" accept=".zip" onChange={handleImport} />
                              </label>
                           </div>
                        )}

                        {(addTab === "modrinth" || addTab === "curseforge" || addTab === "atlauncher" || addTab === "technic") && (
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
                                             if (!newName) setNewName(pack.name);
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
                <button className="flex items-center gap-2 text-neutral-500 hover:text-white transition-colors text-xs font-medium">
                   <AlertCircle className="w-4 h-4" /> Help
                </button>
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
                        disabled={!newName || (addTab !== 'custom' && addTab !== 'import' && (!selectedModpack || !selectedModpackVersion))}
                        className={`flex items-center gap-2 px-8 py-2 rounded font-bold text-sm shadow-xl transition-all ${
                          !newName || (addTab !== 'custom' && addTab !== 'import' && (!selectedModpack || !selectedModpackVersion)) ? 'bg-neutral-800 text-neutral-600 cursor-not-allowed border border-[#333]' : 'bg-[#3E8ED0] hover:bg-[#2B6A9E] text-white shadow-[#3E8ED0]/10'
                        }`}
                      >
                        Next <ChevronRight className="w-4 h-4" />
                      </button>
                   ) : (
                      <button 
                        onClick={handleAddInstance}
                        disabled={isCreating || !newName}
                        className={`px-8 py-2 rounded font-bold text-sm shadow-xl transition-all ${
                          isCreating || !newName ? 'bg-neutral-800 text-neutral-600 cursor-not-allowed border border-[#333]' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/10'
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
                 <div>
                    <h2 className="text-xl font-bold text-[#E0E0E0]">
                      {isGlobalBrowser ? "Global Folders" : (selectedInstance ? `Editing: ${selectedInstance.name}` : "Editing")}
                    </h2>
                    {selectedInstance && statuses[selectedInstance.id]?.public_ip && !isGlobalBrowser && (
                       <button 
                          onClick={() => copyToClipboard(`${statuses[selectedInstance.id].public_ip}:${statuses[selectedInstance.id].port || 25565}`, 'modal')}
                          className="flex items-center gap-2 mt-1 text-[10px] bg-[#050505] border border-[#3A3A3A] px-2 py-0.5 rounded hover:bg-[#1A1A1A] transition group"
                          title="Click to copy server address"
                       >
                          <span className="text-neutral-500 font-bold uppercase tracking-wider">Address:</span>
                          <span className={`font-mono transition-colors ${copiedId === 'modal' ? 'text-emerald-400' : 'text-emerald-500'}`}>
                             {copiedId === 'modal' ? 'ADDRESS COPIED!' : `${statuses[selectedInstance.id].public_ip}:${statuses[selectedInstance.id].port || 25565}`}
                          </span>
                          <Copy className={`w-2.5 h-2.5 transition-colors ${copiedId === 'modal' ? 'text-emerald-400' : 'text-neutral-600 group-hover:text-[#3E8ED0]'}`} />
                       </button>
                    )}
                 </div>
              </div>
              <button onClick={() => setIsEditModalOpen(false)} className="p-1 hover:bg-[#3A3A3A] rounded-full text-neutral-400 hover:text-white transition">
                <X className="w-6 h-6" />
              </button>
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
                      className={`w-full flex items-center justify-center gap-2 font-bold py-2 rounded shadow-lg transition-all ${
                        JSON.stringify(config) === originalConfig 
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
                  <div className="flex flex-col h-full p-6">
                    <div className="flex justify-between items-center mb-4">
                      <div className="flex items-center gap-4">
                         <div className="flex items-center gap-2">
                           <Terminal className="w-5 h-5 text-neutral-500" />
                           <span className="text-lg font-semibold text-neutral-300">Console Output</span>
                         </div>
                         <div className="flex bg-[#0D0D0D] border border-[#333] p-1 rounded-lg ml-4">
                            <button 
                               onClick={() => setIsVerbose(false)}
                               className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${!isVerbose ? 'bg-[#3E8ED0] text-white' : 'text-neutral-500 hover:text-neutral-300'}`}
                            >
                               Simplified
                            </button>
                            <button 
                               onClick={() => setIsVerbose(true)}
                               className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${isVerbose ? 'bg-[#3E8ED0] text-white' : 'text-neutral-500 hover:text-neutral-300'}`}
                            >
                               Verbose
                            </button>
                         </div>
                      </div>
                      <button 
                        onClick={() => selectedInstance && fetchLogs(selectedInstance.id)}
                        className="flex items-center gap-2 px-4 py-1.5 bg-[#323232] hover:bg-[#404040] rounded-md text-sm font-medium transition-colors border border-[#404040]"
                      >
                        <RefreshCw className={`w-4 h-4 ${isLogsLoading ? 'animate-spin' : ''}`} />
                        Refresh
                      </button>
                    </div>
                    <pre 
                       ref={scrollRef}
                       className="flex-1 bg-[#0D0D0D] rounded-t-lg border border-[#333] p-5 overflow-auto text-xs font-mono text-emerald-400/90 whitespace-pre-wrap selection:bg-[#3E8ED0]/40 shadow-inner scroll-smooth"
                    >
                       {(() => {
                          if (!logs) return "Waiting for output...";
                          if (isVerbose) return logs;
                          
                          const allowedPatterns = [
                            /ERROR/, /FATAL/, /Exception/,
                            /Loading \d+ mods/, / - /, / \\-- /,
                            /Done \(/,
                            /> /, 
                            /issued (server )?command/,
                            /joined the game/, /left the game/,
                            /\[Server thread\/INFO\]: </,
                            /Starting minecraft server version/,
                            /\[Server thread\/INFO\]: \[(?!Rcon: Stopping)/ 
                          ];

                          return logs.split('\n').filter(line => {
                             // Always keep manual commands
                             if (line.includes('> ')) return true;
                             // Check against strict allowlist
                             return allowedPatterns.some(p => p.test(line));
                          }).join('\n');
                       })()}
                    </pre>
                    <div className="flex bg-[#1A1A1A] border-x border-b border-[#333] rounded-b-lg p-3 gap-3">
                       <input 
                          type="text"
                          placeholder="Type a command (whitelist, op, kick...)"
                          className="flex-1 bg-[#050505] border border-[#333] px-3 py-2 rounded text-emerald-500 font-mono text-sm focus:outline-none focus:border-[#3E8ED0]"
                          value={consoleCommand}
                          onChange={(e) => setConsoleCommand(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSendCommand(selectedInstance?.id || "", consoleCommand)}
                          disabled={isExecuting}
                       />
                       <button 
                          onClick={() => handleSendCommand(selectedInstance?.id || "", consoleCommand)}
                          disabled={isExecuting}
                          className="px-4 py-2 bg-[#323232] hover:bg-[#404040] rounded text-xs font-bold text-neutral-400 transition-colors flex items-center gap-2"
                       >
                          {isExecuting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Terminal className="w-3 h-3" />}
                          Send
                       </button>
                    </div>
                  </div>
                )}

                {editTab === "users" && (
                  <div className="flex flex-col h-full p-8 overflow-auto scrollbar-custom text-[#E0E0E0]">
                    <div className="max-w-4xl w-full mx-auto space-y-6">
                      <div className="flex justify-between items-center">
                         <div className="flex items-center gap-3">
                            <Users className="w-6 h-6 text-[#3E8ED0]" />
                            <div>
                               <h3 className="text-xl font-bold">User Management</h3>
                               <p className="text-xs text-neutral-500">Manage whitelist and player permissions (operator status).</p>
                            </div>
                         </div>
                      </div>

                      {/* Add Player Section */}
                      <div className="bg-[#242424] border border-[#3A3A3A] rounded-lg overflow-hidden shadow-xl">
                         <div className="px-4 py-3 bg-[#2D2D2D] border-b border-[#3A3A3A] flex justify-between items-center bg-gradient-to-r from-[#2D2D2D] to-[#242424]">
                            <span className="text-xs font-bold text-neutral-200 uppercase tracking-wider">Add Player to Whitelist</span>
                         </div>
                         <div className="p-5 space-y-4">
                            <div className="flex gap-2">
                               <div className="relative flex-1 group">
                                  <div className="absolute left-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded bg-[#1A1A1A] border border-[#333] flex items-center justify-center overflow-hidden">
                                     {userSearchPreview ? (
                                        <img 
                                           src={`https://crafatar.com/avatars/${userSearchPreview.uuid}?size=32&overlay`} 
                                           referrerPolicy="no-referrer"
                                           alt="" 
                                           className="w-full h-full"
                                           onError={(e) => {
                                              e.currentTarget.src = `https://minotar.net/avatar/${userSearchText}/32`;
                                           }}
                                        />
                                     ) : (
                                        <Users className="w-3 h-3 text-neutral-600" />
                                     )}
                                  </div>
                                  <input 
                                     type="text"
                                     value={userSearchText}
                                     onChange={(e) => setUserSearchText(e.target.value)}
                                     onKeyDown={(e) => {
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
                                                    whitelisted: true
                                                 }
                                              ]);
                                           }
                                           setUserSearchText("");
                                           setUserSearchPreview(null);
                                        }
                                     }}
                                     placeholder="Minecraft Gamertag..."
                                     className="w-full bg-[#1A1A1A] border border-[#333] pl-12 pr-4 py-3 rounded-lg focus:outline-none focus:border-[#3E8ED0]/40 text-sm placeholder:text-neutral-700 transition-all font-medium"
                                  />
                                  {isUserSearchVerifying && (
                                     <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-neutral-600" />
                                     </div>
                                  )}
                                  {userSearchPreview && (
                                     <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[#3E8ED0]/80 bg-[#3E8ED0]/5 px-2 py-0.5 rounded border border-[#3E8ED0]/20">
                                        FOUND
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
                                                 whitelisted: true
                                              }
                                           ]);
                                        }
                                        setUserSearchText("");
                                        setUserSearchPreview(null);
                                     }
                                  }}
                                  className="px-6 py-2 bg-[#3E8ED0] hover:bg-[#2B6A9E] rounded-lg text-sm font-bold transition-all text-white shadow-md shadow-[#3E8ED0]/10"
                               >
                                  Add Player
                               </button>
                            </div>
                         </div>
                      </div>

                      {/* Players List */}
                      <div className="bg-[#242424] border border-[#3A3A3A] rounded-lg overflow-hidden shadow-xl">
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
                               <span className="italic">No players whitelisted or opped on this server.</span>
                            </div>
                         ) : (
                            <div className="overflow-x-auto">
                               <table className="w-full text-left border-collapse text-xs">
                                  <thead>
                                     <tr className="border-b border-[#2D2D2D] text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
                                        <th className="px-5 py-3.5">Player</th>
                                        <th className="px-5 py-3.5">Whitelisted</th>
                                        <th className="px-5 py-3.5">Operator (OP) Level</th>
                                        <th className="px-5 py-3.5 text-right">Actions</th>
                                     </tr>
                                  </thead>
                                  <tbody className="divide-y divide-[#2D2D2D]">
                                     {instanceUsers.map((user, idx) => (
                                        <tr key={user.name} className="hover:bg-[#2A2A2A]/40 transition-colors">
                                           <td className="px-5 py-3 flex items-center gap-3">
                                              <img 
                                                 src={user.uuid ? `https://crafatar.com/avatars/${user.uuid}?size=32&overlay` : `https://minotar.net/avatar/${user.name}/32`} 
                                                 alt="" 
                                                 className="w-7 h-7 rounded bg-[#141414] border border-[#333]"
                                                 onError={(e) => {
                                                    e.currentTarget.src = `https://minotar.net/avatar/${user.name}/32`;
                                                 }}
                                              />
                                              <div className="flex flex-col">
                                                 <span className="text-sm font-bold text-neutral-200">{user.name}</span>
                                                 {user.uuid && <span className="text-[9px] font-mono text-neutral-600">{user.uuid}</span>}
                                              </div>
                                           </td>
                                           <td className="px-5 py-3">
                                              <button
                                                 onClick={() => {
                                                    setInstanceUsers(prev => prev.map((u, i) => i === idx ? { ...u, whitelisted: !u.whitelisted } : u));
                                                 }}
                                                 className={`px-3 py-1 rounded text-[10px] font-bold transition-all border ${user.whitelisted ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-neutral-800 border-neutral-700 text-neutral-500'}`}
                                              >
                                                 {user.whitelisted ? 'WHITELISTED' : 'BYPASSED'}
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
                                                 onClick={() => {
                                                    setInstanceUsers(prev => prev.filter((_, i) => i !== idx));
                                                 }}
                                                 className="p-1.5 bg-[#3D2525]/30 hover:bg-red-500/20 text-red-400 rounded border border-red-500/20 transition-all"
                                                 title="Remove from Whitelist"
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
                            onClick={() => fetchInstanceUsers(selectedInstance?.id || "")}
                            className="px-5 py-2.5 rounded-lg text-neutral-400 hover:bg-[#323232] hover:text-white font-bold transition-all text-xs"
                         >
                            Discard Changes
                         </button>
                         <button 
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
                    <div className="flex flex-col h-full p-8 max-w-2xl mx-auto w-full">
                       <div className="flex flex-col gap-8 text-neutral-300">
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

                          <div className="bg-[#242424] border border-[#3A3A3A] p-4 rounded-lg">
                             <label className="block text-sm font-medium text-neutral-400 mb-2">Advanced: Loader Version</label>
                             <input 
                                type="text"
                                className="w-full bg-[#141414] border border-[#3A3A3A] p-2.5 rounded focus:outline-none focus:border-[#3E8ED0] text-[#E0E0E0] font-mono text-sm"
                                value={config.environment["LOADER_VERSION"] || ""}
                                onChange={(e) => setConfig(prev => ({
                                   ...prev,
                                   environment: { ...prev.environment, LOADER_VERSION: e.target.value }
                                }))}
                                placeholder="latest"
                             />
                             <p className="text-[10px] text-neutral-500 mt-2 italic">Leave empty for latest recommended version.</p>
                          </div>
                       </div>
                    </div>
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
                          /* INSTALLED MODS LIST VIEW */
                          <div className="flex flex-col h-full">
                             <div className="p-4 border-b border-[#323232] bg-[#242424] flex items-center justify-between">
                                <h3 className="text-lg font-bold flex items-center gap-2">
                                   Mods ({installedModsMeta.length} installed)
                                </h3>
                                <div className="flex gap-2">
                                   <button 
                                      onClick={() => setModListView("search")}
                                      className="flex items-center gap-2 bg-[#3E8ED0] hover:bg-[#2B6A9E] text-white px-4 py-1.5 rounded text-sm font-bold transition-all"
                                   >
                                      <Plus className="w-4 h-4" /> Download Mods
                                   </button>
                                   <button 
                                      onClick={fetchInstalledModsMeta}
                                      className="flex items-center gap-2 bg-[#333] hover:bg-[#444] text-white px-3 py-1.5 rounded text-sm font-bold transition-all"
                                   >
                                      <RefreshCw className={`w-4 h-4 ${isMetaLoading ? 'animate-spin' : ''}`} /> Check Updates
                                   </button>
                                </div>
                             </div>

                             <div className="flex-1 overflow-auto p-4">
                                <div className="bg-[#242424] border border-[#323232] rounded-lg overflow-hidden">
                                   <table className="w-full text-left border-collapse">
                                      <thead>
                                         <tr className="bg-[#2D2D2D] border-b border-[#323232] text-[11px] font-bold text-neutral-500 uppercase tracking-widest">
                                            <th className="px-4 py-2 w-12 text-center">Enable</th>
                                            <th className="px-4 py-2 w-16">Image</th>
                                            <th className="px-4 py-2">Name</th>
                                            <th className="px-4 py-2">Versions</th>
                                            <th className="px-4 py-2">Provider</th>
                                            <th className="px-4 py-2 text-right">Actions</th>
                                         </tr>
                                      </thead>
                                      <tbody className="divide-y divide-[#323232]">
                                         {installedModsMeta.length === 0 ? (
                                            <tr>
                                               <td colSpan={6} className="p-12 text-center text-neutral-600 italic text-sm">
                                                  No mods installed yet. Click "Download Mods" to start!
                                               </td>
                                            </tr>
                                         ) : (
                                            installedModsMeta.map((mod) => (
                                               <tr key={mod.id} className="hover:bg-[#2A2A2A] transition-colors group">
                                                  <td className="px-4 py-3 text-center">
                                                     <input type="checkbox" checked readOnly className="rounded border-[#3E8ED0] bg-[#1A1A1A] accent-[#3E8ED0]" />
                                                  </td>
                                                  <td className="px-4 py-3">
                                                     <div className="w-10 h-10 bg-[#333] rounded overflow-hidden shadow-inner flex items-center justify-center">
                                                        {mod.icon_url ? <img src={mod.icon_url} className="w-full h-full object-cover" /> : <Box className="w-5 h-5 text-neutral-600" />}
                                                     </div>
                                                  </td>
                                                  <td className="px-4 py-3">
                                                     <div className="flex flex-col">
                                                        <span className="font-bold text-sm text-[#E0E0E0]">{mod.name || mod.id}</span>
                                                        <span className="text-[10px] text-neutral-500 truncate max-w-md">{mod.summary || "No description available"}</span>
                                                     </div>
                                                  </td>
                                                  <td className="px-4 py-3">
                                                     <div className="flex flex-col gap-1.5">
                                                        {mod.latest_version && (
                                                           <div className="flex items-center gap-2">
                                                              <span className="text-[9px] text-neutral-500 font-medium uppercase tracking-tighter opacity-70">Mod</span>
                                                              <span className="text-[10px] font-bold text-[#3E8ED0] bg-[#3E8ED0]/10 px-1.5 py-0.5 rounded border border-[#3E8ED0]/20 truncate max-w-[140px]" title={mod.latest_version}>
                                                                 {mod.latest_version}
                                                              </span>
                                                           </div>
                                                        )}
                                                        {mod.mc_versions && mod.mc_versions.length > 0 && (
                                                           <div className="flex items-center gap-2">
                                                              <span className="text-[9px] text-neutral-500 font-medium uppercase tracking-tighter opacity-70">Game</span>
                                                              <div className="flex gap-1 overflow-hidden">
                                                                 {mod.mc_versions.map((v: string) => (
                                                                    <span key={v} className="text-[9px] font-bold text-emerald-400 bg-emerald-400/10 px-1 py-0.5 rounded border border-emerald-400/20 whitespace-nowrap">
                                                                       {v}
                                                                    </span>
                                                                 ))}
                                                              </div>
                                                           </div>
                                                        )}
                                                     </div>
                                                     </td>
                                                     <td className="px-4 py-3 text-center">
                                                        <span className="text-[10px] font-bold bg-[#333] px-2 py-0.5 rounded text-neutral-400 capitalize">{mod.provider}</span>
                                                  </td>
                                                  <td className="px-4 py-3 text-right">
                                                     <div className="flex justify-end gap-2 group-hover:opacity-100 opacity-0 transition-opacity">
                                                        <a href={mod.url} target="_blank" className="p-1.5 hover:text-white text-neutral-500"><ExternalLink className="w-4 h-4" /></a>
                                                        <button 
                                                           onClick={() => {
                                                              const envKey = mod.provider === 'modrinth' ? 'MODRINTH_PROJECTS' : 'CF_PROJECTS';
                                                              const current = (config.environment[envKey] || "").split(',').map(s => s.trim()).filter(Boolean);
                                                              const newList = current.filter(x => x !== mod.id).join(',');
                                                              setConfig(prev => ({
                                                                 ...prev,
                                                                 environment: { ...prev.environment, [envKey]: newList }
                                                              }));
                                                           }}
                                                           className="p-1.5 hover:text-red-400 text-neutral-500"
                                                        >
                                                           <Trash2 className="w-4 h-4" />
                                                        </button>
                                                     </div>
                                                  </td>
                                               </tr>
                                            ))
                                         )}
                                      </tbody>
                                   </table>
                                </div>
                             </div>
                             
                             <div className="p-4 bg-[#242424] border-t border-[#323232] text-[10px] text-neutral-500 italic">
                                These mods will be automatically downloaded and synchronized on server startup.
                             </div>
                          </div>
                       ) : (
                          /* SEARCH / DOWNLOAD VIEW */
                          <div className="flex flex-col h-full overflow-hidden">
                             <div className="p-4 border-b border-[#323232] bg-[#242424] flex items-center gap-4 shadow-sm">
                                <button 
                                   onClick={() => setModListView("list")}
                                   className="p-2 hover:bg-[#333] rounded-full transition-colors text-neutral-400 hover:text-white"
                                >
                                   <X className="w-5 h-5" />
                                </button>
                                <h3 className="text-xl font-bold flex items-center gap-2">
                                   {modSearchProvider === 'modrinth' ? 'Modrinth Mod Search' : 'CurseForge Mod Search'}
                                   {isModSearching && <RefreshCw className="w-4 h-4 animate-spin text-[#3E8ED0]" />}
                                </h3>
                                <div className="flex bg-[#1A1A1A] border border-[#3A3A3A] p-1 rounded-lg ml-auto">
                                   <button 
                                      onClick={() => setModSearchProvider("modrinth")}
                                      className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${modSearchProvider === 'modrinth' ? 'bg-[#3E8ED0] text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-300'}`}
                                   >
                                      Modrinth
                                   </button>
                                   <button 
                                      onClick={() => setModSearchProvider("curseforge")}
                                      className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${modSearchProvider === 'curseforge' ? 'bg-[#3E8ED0] text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-300'}`}
                                   >
                                      CurseForge
                                   </button>
                                </div>
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
                                      onChange={(e) => setModSearchVersion(e.target.value)}
                                   >
                                      <option value="">Any Version</option>
                                      {mcVersions.filter((v: any) => v.type === "release").slice(0, 150).map((v: any) => (
                                         <option key={v.id} value={v.id}>{v.id}</option>
                                      ))}
                                   </select>

                                   <select 
                                      className="bg-[#1A1A1A] border border-[#3A3A3A] px-3 py-2 rounded text-xs focus:outline-none focus:border-[#3E8ED0]"
                                      value={modSearchLoader}
                                      onChange={(e) => setModSearchLoader(e.target.value)}
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
                                         const envKey = modSearchProvider === 'modrinth' ? "MODRINTH_PROJECTS" : "CF_PROJECTS";
                                         const currentList: string = config.environment[envKey] || "";
                                         const isAdded = currentList.split(',').map(s => s.trim()).includes(res.id);
                                         
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
                                                          const instanceLoader = config.environment["TYPE"] || "";
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
                                                              onClick={() => {
                                                                 const currentList: string = config.environment[envKey] || "";
                                                                 const currentItems = currentList.split(',').map(s => s.trim()).filter(Boolean);
                                                                 const newListSet = new Set([...currentItems, res.id]);
                                                                 setConfig(prev => ({
                                                                    ...prev,
                                                                    environment: { ...prev.environment, [envKey]: Array.from(newListSet).join(',') }
                                                                 }));
                                                              }}
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

                              <div className="flex-1 overflow-auto p-4">
                                 <div className="bg-[#242424] border border-[#323232] rounded-lg overflow-hidden">
                                    <table className="w-full text-left border-collapse">
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
                                                                   const newList = current.filter(x => x !== pack.id).join(',');
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
                                     Search Resource Packs
                                     {isResourcePackSearching && <RefreshCw className="w-4 h-4 animate-spin text-[#3E8ED0]" />}
                                  </h3>
                                  <div className="flex bg-[#1A1A1A] border border-[#3A3A3A] p-1 rounded-lg ml-auto">
                                     <button
                                        onClick={() => setResourcePackProvider("modrinth")}
                                        className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${resourcePackProvider === 'modrinth' ? 'bg-[#3E8ED0] text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-300'}`}
                                     >
                                        Modrinth
                                     </button>
                                     <button
                                        onClick={() => setResourcePackProvider("curseforge")}
                                        className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${resourcePackProvider === 'curseforge' ? 'bg-[#3E8ED0] text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-300'}`}
                                     >
                                        CurseForge
                                     </button>
                                  </div>
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
                                           const envKey = resourcePackProvider === 'modrinth' ? "RESOURCE_PACKS_MODRINTH" : "RESOURCE_PACKS_CF";
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
                    <div className="flex flex-col h-full bg-[#1A1A1A] p-6 overflow-hidden">
                       <div className="flex justify-between items-center mb-6">
                          <div className="flex flex-col">
                             <h3 className="text-xl font-bold flex items-center gap-2">
                                <Folder className="w-6 h-6 text-yellow-500" /> {isGlobalBrowser ? "Global Folders" : "Files"}
                             </h3>
                             <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 mt-1">
                                <span>{isGlobalBrowser ? "isopod" : "root"}</span>
                                {currentFilePath !== "." && currentFilePath.split('/').map((seg, i) => (
                                   <React.Fragment key={i}>
                                      <ChevronRight className="w-3 h-3" />
                                      <span>{seg}</span>
                                   </React.Fragment>
                                ))}
                             </div>
                          </div>
                          <div className="flex gap-2">
                             {currentFilePath !== "." && (
                                <button 
                                   onClick={() => {
                                      const parts = currentFilePath.split('/');
                                      parts.pop();
                                      const instanceId = isGlobalBrowser ? null : (selectedInstance?.id || null);
                                      fetchFileList(instanceId, parts.join('/') || ".");
                                   }}
                                   className="flex items-center gap-2 px-3 py-1.5 bg-[#323232] hover:bg-[#404040] rounded text-sm transition"
                                >
                                   <ArrowLeft className="w-4 h-4" /> Go Back
                                </button>
                             )}
                             <button 
                                onClick={() => fetchFileList(isGlobalBrowser ? null : (selectedInstance?.id || null), currentFilePath)}
                                className="flex items-center justify-center p-2 bg-[#323232] hover:bg-[#404040] rounded text-neutral-300 transition"
                             >
                                <RefreshCw className={`w-4 h-4 ${isFilesLoading ? 'animate-spin' : ''}`} />
                             </button>
                          </div>
                       </div>

                       {viewingFile ? (
                          <div className="flex flex-col flex-1 bg-[#0D0D0D] border border-[#333] rounded-lg overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
                             <div className="px-4 py-2.5 bg-[#1F1F1F] border-b border-[#333] flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                   <FileText className="w-4 h-4 text-[#3E8ED0]" />
                                   <span className="text-sm font-bold text-neutral-300">{viewingFile.name}</span>
                                </div>
                                <button onClick={() => setViewingFile(null)} className="p-1 hover:bg-[#333] rounded text-neutral-500 hover:text-white transition">
                                   <X className="w-5 h-5" />
                                </button>
                             </div>
                             <pre className="flex-1 p-6 overflow-auto text-xs font-mono text-neutral-400 selection:bg-[#3E8ED0]/30 whitespace-pre scrollbar-custom">
                                {viewingFile.content}
                             </pre>
                          </div>
                       ) : (
                          <div className="flex-1 bg-[#1E1E1E]/50 border border-[#333] rounded-lg overflow-hidden shadow-2xl">
                             <div className="grid grid-cols-12 px-4 py-2 border-b border-[#333] text-[10px] uppercase font-bold text-neutral-500 tracking-wider bg-[#242424]">
                                <div className="col-span-7">Name</div>
                                <div className="col-span-2">Size</div>
                                <div className="col-span-3">Modified</div>
                             </div>
                             <div className="flex-1 overflow-auto max-h-[calc(85vh-240px)] scrollbar-custom">
                                {isFilesLoading ? (
                                   <div className="flex flex-col items-center justify-center h-64 text-neutral-600 gap-3">
                                      <RefreshCw className="w-8 h-8 animate-spin" />
                                      <span className="text-sm font-medium">Scanning directory...</span>
                                   </div>
                                ) : fileList.length === 0 ? (
                                   <div className="flex flex-col items-center justify-center h-64 text-neutral-600 gap-2 opacity-50">
                                      <Box className="w-10 h-10" />
                                      <span className="text-sm">Empty folder</span>
                                   </div>
                                ) : (
                                   fileList.map((file, i) => {
                                      const isText = ['.txt', '.log', '.properties', '.yml', '.yaml', '.json', '.conf', '.cfg', '.env'].includes(file.ext);
                                      
                                      return (
                                         <div 
                                            key={i} 
                                            onClick={() => {
                                               const newPath = currentFilePath === "." ? file.name : `${currentFilePath}/${file.name}`;
                                               const instanceId = isGlobalBrowser ? null : (selectedInstance?.id || null);
                                               if (file.is_dir) {
                                                  fetchFileList(instanceId, newPath);
                                               } else if (isText) {
                                                  handleOpenFile(instanceId, newPath, file.name);
                                               }
                                            }}
                                            className="grid grid-cols-12 px-4 py-3 border-b border-[#282828] hover:bg-white/[0.03] transition-colors cursor-pointer group"
                                         >
                                            <div className="col-span-7 flex items-center gap-3 min-w-0">
                                               {file.is_dir ? <Folder className="w-4 h-4 text-yellow-500/80 fill-current" /> : <FileText className="w-4 h-4 text-neutral-500" />}
                                               <span className={`text-sm truncate ${file.is_dir ? 'text-neutral-300 font-medium' : 'text-neutral-400 font-normal'} group-hover:text-white transition-colors`}>{file.name}</span>
                                               {isText && <span className="bg-[#3E8ED0]/10 text-[9px] px-1.5 py-0.5 rounded text-[#3E8ED0] font-bold border border-[#3E8ED0]/20 hidden group-hover:block">VIEW</span>}
                                            </div>
                                            <div className="col-span-2 text-xs text-neutral-500 flex items-center">
                                               {file.is_dir ? '--' : (file.size > 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : `${(file.size / 1024).toFixed(1)} KB`)}
                                            </div>
                                            <div className="col-span-3 text-xs text-neutral-600 flex items-center italic">
                                               {new Date(file.modified * 1000).toLocaleDateString()}
                                            </div>
                                         </div>
                                      );
                                   })
                                )}
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

                           <div className="bg-[#242424] border border-[#3A3A3A] rounded-lg overflow-hidden shadow-xl">
                              <div className="px-4 py-3 bg-[#2D2D2D] border-b border-[#3A3A3A] flex justify-between items-center bg-gradient-to-r from-[#2D2D2D] to-[#242424]">
                                 <div className="flex items-center gap-2">
                                    <Shield className="w-4 h-4 text-amber-500" />
                                    <span className="text-xs font-bold text-neutral-200 uppercase tracking-wider">Access Control: Whitelist</span>
                                 </div>
                                 <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-neutral-500 font-bold uppercase">Status:</span>
                                    <button 
                                       onClick={() => setConfig(prev => ({
                                          ...prev,
                                          environment: { 
                                             ...prev.environment, 
                                             ENABLE_WHITELIST: prev.environment["ENABLE_WHITELIST"] === "true" ? "false" : "true" 
                                          }
                                       }))}
                                       className={`px-3 py-1 rounded text-[10px] font-bold transition-all border ${config.environment["ENABLE_WHITELIST"] === "true" ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-neutral-800 border-neutral-700 text-neutral-500'}`}
                                    >
                                       {config.environment["ENABLE_WHITELIST"] === "true" ? 'ENABLED' : 'DISABLED'}
                                    </button>
                                 </div>
                              </div>
                              <div className="p-5 space-y-5">
                                 <div className="flex flex-col gap-3">
                                    <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Add Whitelisted Player</label>
                                    <div className="flex gap-2">
                                       <div className="relative flex-1 group">
                                          <div className="absolute left-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded bg-[#1A1A1A] border border-[#333] flex items-center justify-center overflow-hidden">
                                             {instanceWhitelistPreview ? (
                                                <img 
                                                   src={`https://crafatar.com/avatars/${instanceWhitelistPreview.uuid}?size=32&overlay`} 
                                                   referrerPolicy="no-referrer"
                                                   alt="" 
                                                   className="w-full h-full"
                                                   onError={(e) => {
                                                      e.currentTarget.src = `https://minotar.net/avatar/${instanceWhitelistUser}/32`;
                                                   }}
                                                />
                                             ) : (
                                                <Users className="w-3 h-3 text-neutral-600" />
                                             )}
                                          </div>
                                          <input 
                                             type="text"
                                             value={instanceWhitelistUser}
                                             onChange={(e) => setInstanceWhitelistUser(e.target.value)}
                                             onKeyDown={(e) => {
                                                if (e.key === 'Enter' && instanceWhitelistUser) {
                                                   const current = (config.environment["WHITELIST"] || "").split(',').map(s => s.trim()).filter(Boolean);
                                                   if (!current.includes(instanceWhitelistUser.trim())) {
                                                      const newList = [...current, instanceWhitelistUser.trim()].join(',');
                                                      setConfig(prev => ({ ...prev, environment: { ...prev.environment, WHITELIST: newList } }));
                                                   }
                                                   setInstanceWhitelistUser("");
                                                   setInstanceWhitelistPreview(null);
                                                }
                                             }}
                                             placeholder="Minecraft Gamertag..."
                                             className="w-full bg-[#1A1A1A] border border-[#333] pl-12 pr-4 py-3 rounded-lg focus:outline-none focus:border-amber-500/30 text-sm placeholder:text-neutral-700 transition-all font-medium"
                                          />
                                          {instanceWhitelistPreview && (
                                             <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-amber-500/80 bg-amber-500/5 px-2 py-0.5 rounded border border-amber-500/20">
                                                FOUND
                                             </div>
                                          )}
                                          
                                          {/* Dropdown Suggestions */}
                                          {instanceWhitelistUser.length >= 1 && (
                                             <div className="absolute top-full left-0 right-0 mt-1 bg-[#1E1E1E] border border-[#333] rounded-lg shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                                                {seenPlayers.filter(p => p.name.toLowerCase().includes(instanceWhitelistUser.toLowerCase())).slice(0, 5).map(p => (
                                                   <div 
                                                      key={p.uuid}
                                                      onClick={() => {
                                                         setInstanceWhitelistUser(p.name);
                                                         setInstanceWhitelistPreview(p);
                                                      }}
                                                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#333] cursor-pointer border-b border-[#282828] last:border-0 group"
                                                   >
                                                      <img src={`https://minotar.net/avatar/${p.name}/16`} alt="" className="w-4 h-4 rounded-sm" />
                                                      <span className="text-sm font-medium text-neutral-300 group-hover:text-white">{p.name}</span>
                                                      <span className="text-[10px] text-neutral-600 font-mono ml-auto">RECENT</span>
                                                   </div>
                                                ))}
                                                {seenPlayers.filter(p => p.name.toLowerCase().includes(instanceWhitelistUser.toLowerCase())).length === 0 && !instanceWhitelistPreview && !isVerifyingUser && (
                                                   <div className="px-4 py-2.5 text-xs text-neutral-600 italic">No matches found in history.</div>
                                                )}
                                             </div>
                                          )}
                                       </div>
                                       <button 
                                          onClick={() => {
                                             if (instanceWhitelistUser.trim()) {
                                                const current = (config.environment["WHITELIST"] || "").split(',').map(s => s.trim()).filter(Boolean);
                                                if (!current.includes(instanceWhitelistUser.trim())) {
                                                   const newList = [...current, instanceWhitelistUser.trim()].join(',');
                                                   setConfig(prev => ({ ...prev, environment: { ...prev.environment, WHITELIST: newList } }));
                                                }
                                                setInstanceWhitelistUser("");
                                                setInstanceWhitelistPreview(null);
                                             }
                                          }}
                                          className="px-6 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm font-bold transition-all border border-neutral-700 text-neutral-300"
                                       >
                                          Add
                                       </button>
                                    </div>
                                    
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 min-h-[60px] p-4 bg-[#141414] rounded-xl border border-[#2D2D2D] shadow-inner">
                                       {(config.environment["WHITELIST"] || "").split(',').filter(Boolean).length === 0 ? (
                                          <div className="col-span-full flex flex-col items-center justify-center p-4 text-neutral-700 text-xs gap-2">
                                             <Shield className="w-5 h-5 opacity-20" />
                                             <span className="italic">No users specifically whitelisted in environment.</span>
                                          </div>
                                       ) : (
                                          (config.environment["WHITELIST"] || "").split(',').map(s => s.trim()).filter(Boolean).map(user => (
                                             <div key={user} className="flex items-center justify-between gap-2 px-3 py-2 bg-[#1A1A1A] border border-[#2D2D2D] rounded-lg group hover:border-amber-500/30 transition-all">
                                                <div className="flex items-center gap-2 min-w-0">
                                                   <img src={`https://minotar.net/avatar/${user}/16`} alt="" className="w-4 h-4 rounded-sm" />
                                                   <span className="text-[11px] font-bold text-neutral-300 truncate">{user}</span>
                                                </div>
                                                <button 
                                                   onClick={() => {
                                                      const current = (config.environment["WHITELIST"] || "").split(',').map(s => s.trim()).filter(Boolean);
                                                      const newList = current.filter(u => u !== user).join(',');
                                                      setConfig(prev => ({ ...prev, environment: { ...prev.environment, WHITELIST: newList } }));
                                                   }}
                                                   className="text-neutral-600 hover:text-red-500 transition-colors"
                                                >
                                                   <X className="w-3.5 h-3.5" />
                                                </button>
                                             </div>
                                          ))
                                       )}
                                    </div>
                                 </div>
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
                     <button
                        onClick={() => setIsSettingsModalOpen(false)}
                        className="p-1.5 hover:bg-[#3A3A3A] rounded-full text-neutral-400 hover:text-white transition"
                     >
                        <X className="w-6 h-6" />
                     </button>
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
                              <div className="grid grid-cols-3 gap-4">
                                 {[
                                    { id: 'Dark', name: 'Dark Mode', icon: Moon },
                                    { id: 'Light', name: 'Light Mode', icon: Sun },
                                    { id: 'OLED', name: 'OLED Black', icon: Monitor }
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
                                           onChange={(e) => setGlobalSettings({...globalSettings, defaultMemory: e.target.value})}
                                           placeholder="1G"
                                           className="flex-1 bg-[#141414] border border-[#333] p-3 rounded-lg focus:outline-none focus:border-[#3E8ED0] text-sm font-mono text-[#3E8ED0]"
                                        />
                                        <div className="flex bg-[#242424] rounded-lg p-1 border border-[#333] gap-1">
                                           {['1G', '2G', '4G', '6G', '8G'].map(m => (
                                              <button 
                                                 key={m}
                                                 type="button"
                                                 onClick={() => setGlobalSettings({...globalSettings, defaultMemory: m})}
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

                                    {globalSettings.defaultWhitelistEnabled && (
                                       <div className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                                          <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest block">Default Whitelisted Players</label>
                                          <div className="flex gap-2">
                                             <div className="relative flex-1">
                                                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-sm bg-[#1A1A1A] border border-[#333] flex items-center justify-center overflow-hidden">
                                                   {whitelistPreview ? (
                                                      <img
                                                         src={`https://crafatar.com/avatars/${whitelistPreview.uuid}?size=32&overlay`}
                                                         referrerPolicy="no-referrer"
                                                         alt=""
                                                         className="w-full h-full"
                                                         onError={(e) => {
                                                            e.currentTarget.src = `https://minotar.net/avatar/${newWhitelistUser}/32`;
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
                                                            <img src={`https://minotar.net/avatar/${p.name}/16`} alt="" className="w-4 h-4 rounded-sm" />
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
                                                      <img src={`https://minotar.net/avatar/${user}/16`} alt="" className="w-3 h-3 rounded-sm" />
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
                                    )}
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
                                       defaultValue="/var/run/docker.sock"
                                       className="w-full bg-[#141414] border border-[#333] p-3 rounded-lg focus:outline-none focus:border-red-500/50 text-xs font-mono text-neutral-400"
                                    />
                                 </div>
                                 <button className="w-full py-3 bg-[#333] hover:bg-[#3D2525] text-red-400 font-bold rounded-lg border border-[#444] hover:border-red-500/30 transition-all text-xs">
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
                    className={`px-8 py-2.5 rounded-lg flex items-center gap-2 font-bold transition-all shadow-xl text-sm ${
                      JSON.stringify(globalSettings) === originalGlobalSettings 
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
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors text-left ${
                    isRunning 
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
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors text-left ${
                    !isRunning 
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
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors text-left ${
                    !isRunning 
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
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div className="bg-[#2A2A2A] border border-[#3A3A3A] rounded-lg shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
              <div className="px-6 py-4 border-b border-[#323232] bg-[#242424] flex items-center gap-3">
                 {dialog.type === 'alert' && <AlertCircle className="w-5 h-5 text-amber-500" />}
                 {dialog.type === 'confirm' && <HelpCircle className="w-5 h-5 text-[#3E8ED0]" />}
                 {dialog.type === 'prompt' && <Edit className="w-5 h-5 text-[#3E8ED0]" />}
                 <h3 className="font-bold text-white tracking-wide uppercase text-[10px]">{dialog.title}</h3>
              </div>
              <div className="p-6">
                 <p className="text-neutral-300 text-sm leading-relaxed mb-4">{dialog.message}</p>
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
    </div>

  );
}
