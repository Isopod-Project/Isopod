import React, { useEffect, useState, useRef } from "react";
import { Folder, Play, Square, Settings, Plus, RefreshCw, Layers, Gamepad2, AlertCircle, Edit, Trash2, Database, Cpu, Box, Terminal, X, Search, Check, ExternalLink, Save, ChevronRight, FileText, ArrowLeft, Monitor, Shield, Sun, Moon, Languages, Users, Copy } from "lucide-react";

interface Instance {
  id: string;
  name: string;
  path: string;
  has_compose: boolean;
  status: string; // "Valid"
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
  
  // Selected Instance for the right sidebar
  const [selectedId, setSelectedId] = useState<string | null>(null);
  
  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPort, setNewPort] = useState("25565");
  const [isCreating, setIsCreating] = useState(false);
  
  // Prism-like Add Modal States
  const [addTab, setAddTab] = useState<"custom" | "import" | "modrinth" | "curseforge">("custom");
  const [selectedAddVersion, setSelectedAddVersion] = useState("latest");
  const [selectedAddLoader, setSelectedAddLoader] = useState("VANILLA");
  const [searchModpacks, setSearchModpacks] = useState("");
  const [modpackResults, setModpackResults] = useState<any[]>([]);
  const [isModpackLoading, setIsModpackLoading] = useState(false);
  const [selectedModpack, setSelectedModpack] = useState<any>(null);
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
  
  // Edit Modal states
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editTab, setEditTab] = useState("logs");
  const [logs, setLogs] = useState("");
  const [isLogsLoading, setIsLogsLoading] = useState(false);
  // Instance Config States
  const [config, setConfig] = useState<{image: string, environment: Record<string, string>}>({image: "", environment: {}});
  const [originalConfig, setOriginalConfig] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  
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
  const [isExecuting, setIsExecuting] = useState(false);
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
  
  // Global App Settings
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("general");
  const [globalSettings, setGlobalSettings] = useState({
     language: 'English',
     theme: 'Dark',
     defaultPort: '25565',
     defaultLoader: 'VANILLA',
     autoRefresh: true,
     showSnapshots: false,
     defaultWhitelistEnabled: false,
     defaultWhitelistUsers: [] as string[]
  });
  const [originalGlobalSettings, setOriginalGlobalSettings] = useState("");
  const [isSavingGlobal, setIsSavingGlobal] = useState(false);
  const [seenPlayers, setSeenPlayers] = useState<{name: string, uuid: string}[]>([]);
  const [newWhitelistUser, setNewWhitelistUser] = useState("");
  const [whitelistPreview, setWhitelistPreview] = useState<{name: string, uuid: string} | null>(null);
  const [isVerifyingUser, setIsVerifyingUser] = useState(false);
  
  // Instance Whitelist States
  const [instanceWhitelistUser, setInstanceWhitelistUser] = useState("");
  const [instanceWhitelistPreview, setInstanceWhitelistPreview] = useState<{name: string, uuid: string} | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
      alert("Failed to connect to Isopod backend. Is it running on port 8000?");
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
      alert(`Launch Error: ${e instanceof Error ? e.message : String(e)}`);
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
      alert(`Stop Error: ${e instanceof Error ? e.message : String(e)}`);
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
        cf_id: addTab === 'curseforge' && selectedModpack ? selectedModpack.id : null
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
      setSelectedAddVersion("latest");
      setSelectedAddLoader("VANILLA");
      setSelectedAddLoaderVersion("latest");
      
      fetchInstances();
    } catch (e) {
      console.error(e);
      alert("Failed to create instance");
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to permanently delete this instance and all its files?")) return;
    try {
      await fetch(`/api/instances/${id}`, { method: "DELETE" });
      setSelectedId(null);
      fetchInstances();
    } catch (err) {
      console.error(err);
      alert("Error deleting instance");
    }
  };

  const fetchLogs = async (id: string) => {
    setIsLogsLoading(true);
    try {
      const res = await fetch(`/api/instances/${id}/logs`);
      const data = await res.json();
      setLogs(data.logs);
    } catch (e) {
      console.error(e);
      setLogs("Failed to load logs.");
    } finally {
      setIsLogsLoading(false);
    }
  };

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
      const res = await fetch(`/api/mods/search/${provider}?q=${encodeURIComponent(query)}&class_type=modpack`);
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
    if (JSON.stringify(config) === originalConfig) {
      alert("No changes to save.");
      return;
    }

    const status = statuses[selectedId];
    const isRunning = status && status.is_running;

    let proceed = false;
    let shouldRestartAfter = false;

    if (isRunning) {
      if (confirm("Apply changes and restart the server now?")) {
        proceed = true;
        shouldRestartAfter = true;
      }
    } else {
      if (confirm("Save changes to instance configuration?")) {
        proceed = true;
      }
    }

    if (!proceed) return;
    
    setIsSaving(true);
    try {
      const res = await fetch(`/api/instances/${selectedId}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });
      if (!res.ok) throw new Error("Failed to save config");
      setOriginalConfig(JSON.stringify(config));
      
      if (shouldRestartAfter) {
        setIsEditModalOpen(false); // Exit to main screen
        handleRestart(selectedId);
      } else {
        alert("Changes saved explicitly.");
      }

    } catch (e: any) {
      alert("Save Error: " + e.message);
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

  const fetchFileList = async (id: string, path: string = ".") => {
    setIsFilesLoading(true);
    try {
      const res = await fetch(`/api/instances/${id}/files?path=${encodeURIComponent(path)}`);
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

  const handleOpenFile = async (id: string, path: string, name: string) => {
     try {
        const res = await fetch(`/api/instances/${id}/file/content?path=${encodeURIComponent(path)}`);
        if (!res.ok) throw new Error("Could not read file");
        const data = await res.json();
        setViewingFile({ name, content: data.content });
     } catch (e: any) {
        alert(e.message);
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
      alert("Search Error: " + e.message);
    } finally {
      setIsModSearching(false);
    }
  };

  const fetchInstalledModsMeta = async () => {
    if (!config || !config.environment) return;
    const mIdsEnv = config.environment["MODRINTH_PROJECTS"] || "";
    const cIdsEnv = config.environment["CF_PROJECTS"] || "";
    if (!mIdsEnv && !cIdsEnv) {
      setInstalledModsMeta([]);
      return;
    }
    
    setIsMetaLoading(true);
    try {
      const res = await fetch(`/api/mods/metadata?modrinth_ids=${mIdsEnv}&cf_ids=${cIdsEnv}`);
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

  const handleSendCommand = async (id: string, cmd: string) => {
    if (!cmd.trim()) return;
    setIsExecuting(true);
    try {
      const res = await fetch(`/api/instances/${id}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd })
      });
      const data = await res.json();
      setLogs(prev => prev + `\n> ${cmd}\n${data.output}`);
      setConsoleCommand("");
    } catch (e) {
      console.error("Failed to send command", e);
    } finally {
      setIsExecuting(false);
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

  useEffect(() => {
    if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, editTab]);

  const openEditModal = () => {
    if (!selectedId) return;
    setIsEditModalOpen(true);
    setEditTab("logs");
    fetchLogs(selectedId);
    fetchConfig(selectedId);
    fetchMcVersions();
  };

  useEffect(() => {
    fetchInstances();
    fetchMcVersions();
    
    const interval = setInterval(() => {
        setInstances((prevInstances: Instance[]) => {
            prevInstances.forEach((inst: Instance) => fetchStatus(inst.id));
            return prevInstances;
        });
    }, 5000);
    
    return () => clearInterval(interval);
  }, []);

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
  }, [isEditModalOpen, editTab, selectedId, isLogsLoading]);

  // Sync mod search filters when config is loaded
  useEffect(() => {
    if (isEditModalOpen && config.environment) {
      const v = config.environment["VERSION"] || "";
      const l = config.environment["TYPE"] || "";
      setModSearchVersion(v);
      setModSearchLoader(l);
      fetchInstalledModsMeta();
      // Auto-browse when opening search
      handleModSearch("", modSearchProvider, v, l);
    }
  }, [isEditModalOpen, config.environment]);

  // Debounced search
  useEffect(() => {
    if (modListView === "search") {
      const timer = setTimeout(() => {
        handleModSearch(modSearchQuery, modSearchProvider);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [modSearchQuery, modSearchProvider]);

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

  const openSettings = () => {
    setOriginalGlobalSettings(JSON.stringify(globalSettings));
    setIsSettingsModalOpen(true);
    setSettingsTab("general");
  };

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

  const handleSaveGlobalSettings = async () => {
    setIsSavingGlobal(true);
    // Simulation of saving settings
    await new Promise(r => setTimeout(r, 600));
    setOriginalGlobalSettings(JSON.stringify(globalSettings));
    setIsSavingGlobal(false);
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
                if (selectedId) {
                  setIsEditModalOpen(true);
                  setEditTab("files");
                  fetchFileList(selectedId);
                }
             }}
             className="flex items-center gap-2 hover:bg-[#4A4A4A] px-3 py-1.5 rounded transition-colors text-sm font-medium"
          >
            <Folder className="w-4 h-4 text-yellow-500" />
            Folders
          </button>
          <button 
             onClick={openSettings}
             className="flex items-center gap-2 hover:bg-[#4A4A4A] px-3 py-1.5 rounded transition-colors text-sm font-medium"
          >
            <Settings className="w-4 h-4 text-neutral-300" />
            Settings
          </button>
          <button 
            onClick={fetchInstances}
            className="flex items-center gap-2 hover:bg-[#4A4A4A] px-3 py-1.5 rounded transition-colors text-sm font-medium ml-auto"
          >
            <RefreshCw className="w-4 h-4 text-sky-400" />
            Refresh
          </button>
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
            <div>
              <div className="flex items-center gap-2 border-b border-[#404040] pb-2 mb-4 cursor-default">
                 <Layers className="w-4 h-4 text-neutral-400" />
                 <span className="font-semibold text-neutral-300">Ungrouped</span>
              </div>
              
              <div className="flex flex-wrap gap-4">
                {instances.map((inst) => {
                  const isSelected = selectedId === inst.id;
                  const isRunning = statuses[inst.id]?.is_running;
                  
                  return (
                    <div 
                      key={inst.id}
                      onClick={() => setSelectedId(inst.id)}
                      className={`flex flex-col items-center justify-center p-3 rounded cursor-pointer transition-all w-[110px] select-none ${
                        isSelected 
                          ? 'bg-[#3E8ED0]/20 outline outline-2 outline-[#3E8ED0] shadow-sm' 
                          : 'hover:bg-[#404040] border border-transparent'
                      }`}
                    >
                      <div className="relative mb-3 flex items-center justify-center w-[72px] h-[72px] bg-[#3B3B3B] rounded shadow-inner">
                        <Gamepad2 className={`w-10 h-10 ${isRunning ? (statuses[inst.id]?.is_ready ? 'text-emerald-400' : 'text-amber-400') : 'text-[#878787]'}`} />
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
              <div className="w-24 h-24 bg-[#3B3B3B] rounded-lg shadow-inner flex flex-col items-center justify-center mb-4 relative">
                 <Gamepad2 className="w-12 h-12 text-[#878787]" />
                 {selectedStatus?.is_running && (
                   <span className="absolute top-2 right-2 flex h-3 w-3">
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
                <button 
                  onClick={(e: React.MouseEvent) => handleStop(selectedInstance.id, e)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded bg-[#402020] hover:bg-[#5A2525] border border-[#502020] text-red-400 transition-colors"
                >
                  <Square className="w-4 h-4 fill-current" />
                  <span className="font-semibold">Kill</span>
                </button>
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
                   setIsEditModalOpen(true);
                   setEditTab("files");
                   fetchFileList(selectedInstance.id);
                 }}
                 className="flex items-center gap-3 px-3 py-1.5 rounded hover:bg-[#323232] text-neutral-300 transition-colors"
               >
                 <Folder className="w-4 h-4" /> Folder
               </button>
              <button 
                 onClick={openSettings}
                 className="flex items-center gap-3 px-3 py-1.5 rounded hover:bg-[#323232] text-neutral-300 transition-colors"
              >
                <Settings className="w-4 h-4" /> Settings
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
               {/* Sidebar */}
               <div className="w-48 bg-[#1E1E1E] border-r border-[#323232] p-2 flex flex-col gap-1">
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

               {/* Content Area */}
               <div className="flex-1 bg-[#1A1A1A] flex flex-col overflow-hidden">
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

                  {(addTab === "modrinth" || addTab === "curseforge") && (
                     <div className="flex flex-col h-full bg-[#1E1E1E]/50">
                        <div className="p-4 bg-[#242424] border-b border-[#323232] flex gap-3">
                           <div className="flex-1 relative">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                              <input 
                                 type="text" 
                                 placeholder={`Search ${addTab === 'modrinth' ? 'Modrinth' : 'CurseForge'} modpacks...`}
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
                                    </div>
                                 </div>
                              ))
                           )}
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
                  <button 
                    onClick={() => setIsAddModalOpen(false)}
                    className="px-6 py-2 rounded bg-transparent hover:bg-[#3A3A3A] text-neutral-400 hover:text-white font-bold transition-all text-sm border border-transparent hover:border-[#444]"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleAddInstance}
                    disabled={isCreating || !newName}
                    className={`px-8 py-2 rounded font-bold text-sm shadow-xl transition-all ${
                      isCreating || !newName ? 'bg-neutral-800 text-neutral-600 cursor-not-allowed border border-[#333]' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/10'
                    }`}
                  >
                    {isCreating ? "Creating..." : "OK"}
                  </button>
               </div>
            </div>

          </div>
        </div>
      )}

      {isEditModalOpen && selectedInstance && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-6">
          <div className="bg-[#242424] border border-[#3A3A3A] rounded-lg shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-[#3A3A3A] flex justify-between items-center bg-[#2B2B2B]">
              <div className="flex items-center gap-3">
                 <div className="p-1.5 bg-[#3E8ED0]/10 rounded border border-[#3E8ED0]/30">
                    <Edit className="w-5 h-5 text-[#3E8ED0]" />
                 </div>
                 <div>
                    <h2 className="text-xl font-bold text-[#E0E0E0]">Editing: {selectedInstance.name}</h2>
                    {statuses[selectedInstance.id]?.public_ip && (
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
                       fetchFileList(selectedInstance.id);
                    }}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded text-left font-medium transition-all ${editTab === "files" ? 'bg-[#3E8ED0] text-white shadow-lg' : 'text-neutral-400 hover:bg-[#323232] hover:text-neutral-200'}`}
                  >
                    <Folder className="w-4 h-4" />
                    Files
                  </button>
                  <button 
                    onClick={() => setEditTab("mods")}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded text-left font-medium transition-all ${editTab === "mods" ? 'bg-[#3E8ED0] text-white shadow-lg' : 'text-neutral-400 hover:bg-[#323232] hover:text-neutral-200'}`}
                  >
                    <Box className="w-4 h-4" />
                    Mods
                  </button>
                  <button 
                    onClick={() => setEditTab("config")}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded text-left font-medium transition-all ${editTab === "config" ? 'bg-[#3E8ED0] text-white shadow-lg' : 'text-neutral-400 hover:bg-[#323232] hover:text-neutral-200'}`}
                  >
                    <Settings className="w-4 h-4" />
                    Configuration
                  </button>
                </div>

                 <div className="mt-auto pt-4 flex flex-col gap-2">
                  {JSON.stringify(config) !== originalConfig && (
                    <div className="text-[10px] text-amber-500 font-bold mb-1 flex items-center gap-1 animate-pulse">
                      <AlertCircle className="w-3 h-3" /> Unsaved Changes
                    </div>
                  )}
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
                </div>
              </div>
              
              {/* Main Area */}
              <div className="flex-1 bg-[#1A1A1A] flex flex-col min-w-0 overflow-hidden">
                {editTab === "logs" && (
                  <div className="flex flex-col h-full p-6">
                    <div className="flex justify-between items-center mb-4">
                      <div className="flex items-center gap-2">
                         <Terminal className="w-5 h-5 text-neutral-500" />
                         <span className="text-lg font-semibold text-neutral-300">Console Output</span>
                      </div>
                      <button 
                        onClick={() => fetchLogs(selectedInstance.id)}
                        className="flex items-center gap-2 px-4 py-1.5 bg-[#323232] hover:bg-[#404040] rounded-md text-sm font-medium transition-colors border border-[#404040]"
                      >
                        <RefreshCw className={`w-4 h-4 ${isLogsLoading ? 'animate-spin' : ''}`} />
                        Refresh
                      </button>
                    </div>
                    <pre 
                       ref={scrollRef}
                       className="flex-1 bg-[#0D0D0D] rounded-t-lg border border-[#333] p-5 overflow-auto text-xs font-mono text-emerald-400/90 whitespace-pre-wrap selection:bg-[#3E8ED0]/40 shadow-inner"
                    >
                       {logs || "Waiting for output..."}
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
                                            <th className="px-4 py-2">Provider</th>
                                            <th className="px-4 py-2 text-right">Actions</th>
                                         </tr>
                                      </thead>
                                      <tbody className="divide-y divide-[#323232]">
                                         {installedModsMeta.length === 0 ? (
                                            <tr>
                                               <td colSpan={5} className="p-12 text-center text-neutral-600 italic text-sm">
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

                 {editTab === "files" && (
                   <div className="flex flex-col h-full bg-[#1A1A1A] p-6 overflow-hidden">
                      <div className="flex justify-between items-center mb-6">
                         <div className="flex flex-col">
                            <h3 className="text-xl font-bold flex items-center gap-2">
                               <Folder className="w-6 h-6 text-yellow-500" /> Instance Files
                            </h3>
                            <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 mt-1">
                               <span>root</span>
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
                                     fetchFileList(selectedInstance.id, parts.join('/') || ".");
                                  }}
                                  className="flex items-center gap-2 px-3 py-1.5 bg-[#323232] hover:bg-[#404040] rounded text-sm transition"
                               >
                                  <ArrowLeft className="w-4 h-4" /> Go Back
                               </button>
                            )}
                            <button 
                               onClick={() => fetchFileList(selectedInstance.id, currentFilePath)}
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
                                              if (file.is_dir) {
                                                 fetchFileList(selectedInstance.id, newPath);
                                              } else if (isText) {
                                                 handleOpenFile(selectedInstance.id, newPath, file.name);
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
                     { id: "advanced", name: "Advanced", icon: Shield }
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
                                 onClick={() => setGlobalSettings({...globalSettings, autoRefresh: !globalSettings.autoRefresh})}
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
                                 onClick={() => setGlobalSettings({...globalSettings, showSnapshots: !globalSettings.showSnapshots})}
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
                                 onClick={() => setGlobalSettings({...globalSettings, language: lang})}
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
                                 onClick={() => setGlobalSettings({...globalSettings, theme: theme.id})}
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
                                 onChange={(e) => setGlobalSettings({...globalSettings, defaultPort: e.target.value})}
                                 className="w-full bg-[#141414] border border-[#333] p-3 rounded-lg focus:outline-none focus:border-[#3E8ED0] text-sm font-mono text-emerald-400"
                              />
                           </div>
                           <div className="flex flex-col gap-2">
                              <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Default Mod Loader</label>
                              <div className="grid grid-cols-5 gap-2">
                                 {['VANILLA', 'FABRIC', 'FORGE', 'QUILT', 'NEOFORGE'].map((loader) => (
                                    <button 
                                       key={loader}
                                       onClick={() => setGlobalSettings({...globalSettings, defaultLoader: loader})}
                                       className={`py-2 rounded-md border text-[10px] font-bold transition-all ${globalSettings.defaultLoader === loader ? 'border-[#3E8ED0] bg-[#3E8ED0] text-white' : 'border-[#333] bg-[#242424] text-neutral-500 hover:border-[#444]'}`}
                                    >
                                       {loader}
                                    </button>
                                 ))}
                              </div>
                           </div>

                           <div className="pt-4 border-t border-[#333] space-y-4">
                              <div className="flex items-center justify-between">
                                 <div className="flex flex-col">
                                    <span className="font-bold text-sm text-neutral-200">Default Whitelist</span>
                                    <span className="text-xs text-neutral-500">Enable whitelist by default for new servers.</span>
                                 </div>
                                 <button 
                                    onClick={() => setGlobalSettings({...globalSettings, defaultWhitelistEnabled: !globalSettings.defaultWhitelistEnabled})}
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
    </div>
  );
}
