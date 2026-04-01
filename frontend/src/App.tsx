import React, { useEffect, useState } from "react";
import { Folder, Play, Square, Settings, Plus, RefreshCw, Layers, Gamepad2, AlertCircle, Edit, Trash2, Database, Cpu, Box, Terminal, X, Search, Check, ExternalLink, Save } from "lucide-react";

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
  const [newType, setNewType] = useState("vanilla");
  const [newPort, setNewPort] = useState("25565");
  const [isCreating, setIsCreating] = useState(false);
  
  // Edit Modal states
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editTab, setEditTab] = useState("logs");
  const [logs, setLogs] = useState("");
  const [isLogsLoading, setIsLogsLoading] = useState(false);
  // Instance Config States
  const [config, setConfig] = useState<{image: string, environment: Record<string, string>}>({image: "", environment: {}});
  const [isSaving, setIsSaving] = useState(false);
  
  // Versions
  const [mcVersions, setMcVersions] = useState<any[]>([]);
  
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

  const handleAddInstance = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      const res = await fetch("/api/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, template: newType, port: parseInt(newPort) })
      });
      if (!res.ok) throw new Error("Failed to create instance");
      const data = await res.json();
      setInstances((prev: Instance[]) => [...prev, data]);
      setIsAddModalOpen(false);
      setNewName("");
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
    } catch (e) {
      console.error("Failed to fetch config", e);
    }
  };

  const fetchMcVersions = async () => {
    try {
      const res = await fetch("/api/meta/versions");
      const data = await res.json();
      setMcVersions(data.versions || []);
    } catch (e) {
      console.error("Failed to fetch MC versions", e);
    }
  };


  const handleSaveConfig = async () => {
    if (!selectedId || !config) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/instances/${selectedId}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });
      if (!res.ok) throw new Error("Failed to save config");
      alert("Changes saved successfully!");
    } catch (e: any) {
      alert("Save Error: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleModSearch = async (query: string, provider: string) => {
    if (!query) return;
    setIsModSearching(true);
    try {
      // Default to what's in the search inputs, or fallback to instance configuration
      let mc_version = modSearchVersion || (config?.environment ? (config.environment["VERSION"] || "") : "");
      let raw_loader = modSearchLoader || (config?.environment ? (config.environment["TYPE"] || "") : "");
      
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
    const mIds = config.environment["MODRINTH_PROJECTS"] || "";
    const cIds = config.environment["CF_PROJECTS"] || "";
    if (!mIds && !cIds) {
      setInstalledModsMeta([]);
      return;
    }
    
    setIsMetaLoading(true);
    try {
      const res = await fetch(`/api/mods/metadata?modrinth_ids=${mIds}&cf_ids=${cIds}`);
      const data = await res.json();
      setInstalledModsMeta(data);
    } catch (e) {
      console.error("Failed to fetch installed mods meta", e);
    } finally {
      setIsMetaLoading(false);
    }
  };

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
    
    const interval = setInterval(() => {
        setInstances((prevInstances: Instance[]) => {
            prevInstances.forEach((inst: Instance) => fetchStatus(inst.id));
            return prevInstances;
        });
    }, 5000);
    
    return () => clearInterval(interval);
  }, []);

  // Sync mod search filters when config is loaded
  useEffect(() => {
    if (isEditModalOpen && config.environment) {
      setModSearchVersion(config.environment["VERSION"] || "");
      setModSearchLoader(config.environment["TYPE"] || "");
      fetchInstalledModsMeta();
    }
  }, [isEditModalOpen, config.environment]);

  const selectedInstance = instances.find(i => i.id === selectedId);
  const selectedStatus = selectedId ? statuses[selectedId] : null;

  return (
    <div className="flex h-screen bg-[#242424] text-[#E0E0E0] font-sans selection:bg-[#3E8ED0]/40 overflow-hidden">
      <div className="flex-1 flex flex-col">
        <header className="h-[52px] min-h-[52px] bg-[#3B3B3B] border-b border-[#1E1E1E] flex items-center px-4 gap-4 flex-shrink-0 shadow-sm z-10">
          <button 
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-2 hover:bg-[#4A4A4A] px-3 py-1.5 rounded transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4 text-emerald-400" />
            Add Instance
          </button>
          <button className="flex items-center gap-2 hover:bg-[#4A4A4A] px-3 py-1.5 rounded transition-colors text-sm font-medium">
            <Folder className="w-4 h-4 text-yellow-500" />
            Folders
          </button>
          <button className="flex items-center gap-2 hover:bg-[#4A4A4A] px-3 py-1.5 rounded transition-colors text-sm font-medium">
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
                        <Gamepad2 className={`w-10 h-10 ${isRunning ? 'text-emerald-400' : 'text-[#878787]'}`} />
                        <div className={`absolute bottom-1 right-1 w-3 h-3 rounded-full border-2 border-[#3B3B3B] ${isRunning ? 'bg-emerald-500' : 'bg-neutral-500'}`}></div>
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

      <aside className="w-[280px] min-w-[280px] flex-shrink-0 bg-[#242424] border-l border-[#1E1E1E] flex flex-col shadow-[rgba(0,0,0,0.1)_-4px_0px_15px_-3px] z-20">
        {selectedInstance ? (
          <>
            <div className="p-6 flex flex-col items-center border-b border-[#323232]">
              <div className="w-24 h-24 bg-[#3B3B3B] rounded-lg shadow-inner flex flex-col items-center justify-center mb-4 relative">
                 <Gamepad2 className="w-12 h-12 text-[#878787]" />
                 {selectedStatus?.is_running && (
                   <span className="absolute top-2 right-2 flex h-3 w-3">
                     <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                     <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                   </span>
                 )}

              </div>
              <h2 className="text-lg font-bold text-center leading-tight mb-1">{selectedInstance.name}</h2>
              <p className="text-xs text-neutral-400">
                 {selectedStatus?.is_running ? 'Online (Containers Running)' : 'Offline (Setup Valid)'}
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
              <button className="flex items-center gap-3 px-3 py-1.5 rounded hover:bg-[#323232] text-neutral-300 transition-colors">
                <Folder className="w-4 h-4" /> Folder
              </button>
              <button className="flex items-center gap-3 px-3 py-1.5 rounded hover:bg-[#323232] text-neutral-300 transition-colors">
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
          </>
        ) : (
          <div className="flex flex-col items-center justify-center p-8 h-full text-center text-neutral-500">
             <Layers className="w-12 h-12 mb-4 opacity-30" />
             <p className="text-sm">Select an instance to view actions and details.</p>
          </div>
        )}
      </aside>

      {isAddModalOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#242424] border border-[#3A3A3A] p-6 rounded-lg shadow-xl w-full max-w-md">
            <h2 className="text-xl font-bold mb-4 text-[#E0E0E0]">Add New Instance</h2>
            <form onSubmit={handleAddInstance} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-neutral-300">Server Name</label>
                <input 
                  autoFocus
                  required
                  type="text" 
                  value={newName} 
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)} 
                  className="w-full bg-[#1A1A1A] border border-[#3A3A3A] p-2 rounded focus:outline-none focus:border-[#3E8ED0]"
                  placeholder="e.g. My Vanilla Server"
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium mb-1 text-neutral-300">Type</label>
                  <select 
                    value={newType} 
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setNewType(e.target.value)}
                    className="w-full bg-[#1A1A1A] border border-[#3A3A3A] p-2 rounded focus:outline-none focus:border-[#3E8ED0]"
                  >
                    <option value="vanilla">Vanilla</option>
                    <option value="fabric">Fabric</option>
                    <option value="forge">Forge</option>
                    <option value="paper">Paper</option>
                  </select>
                </div>
                <div className="flex-[0.5]">
                  <label className="block text-sm font-medium mb-1 text-neutral-300">Port</label>
                  <input 
                    required
                    type="number" 
                    value={newPort} 
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPort(e.target.value)} 
                    className="w-full bg-[#1A1A1A] border border-[#3A3A3A] p-2 rounded focus:outline-none focus:border-[#3E8ED0]"
                    placeholder="25565"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-4">
                <button 
                  type="button" 
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded text-neutral-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={isCreating}
                  className={`px-4 py-2 rounded font-medium shadow-sm transition-colors ${
                    isCreating ? 'bg-[#3E8ED0]/50 text-white/50 cursor-not-allowed' : 'bg-[#3E8ED0] hover:bg-[#2B6A9E] text-white'
                  }`}
                >
                  {isCreating ? "Creating..." : "Create"}
                </button>
              </div>
            </form>
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
                 <h2 className="text-xl font-bold text-[#E0E0E0]">Editing: {selectedInstance.name}</h2>
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
                  <button 
                    onClick={handleSaveConfig}
                    disabled={isSaving}
                    className="w-full flex items-center justify-center gap-2 bg-[#3E8ED0] hover:bg-[#2B6A9E] disabled:bg-[#3E8ED0]/40 text-white font-bold py-2 rounded shadow-lg transition"
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
                    <pre className="flex-1 bg-[#0D0D0D] rounded-lg border border-[#333] p-5 overflow-auto text-xs font-mono text-emerald-400/90 whitespace-pre-wrap selection:bg-[#3E8ED0]/40 shadow-inner">
                      {logs || "Waiting for output..."}
                    </pre>
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
                                         onClick={() => setConfig(prev => ({
                                            ...prev,
                                            environment: { ...prev.environment, VERSION: v.id }
                                         }))}
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
                                                              const current = (config.environment[envKey] || "").split(',').filter(Boolean);
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
                                                     <span className="text-[10px] text-neutral-500 font-mono">By {res.author} • {res.downloads.toLocaleString()} downloads</span>
                                                     {isAdded ? (
                                                        <div className="flex items-center gap-1 text-emerald-400 text-[10px] font-bold bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20">
                                                           <Check className="w-3 h-3" /> Added
                                                        </div>
                                                     ) : (
                                                        <button 
                                                           onClick={() => {
                                                              const newList = currentList ? `${currentList},${res.id}` : res.id;
                                                              setConfig(prev => ({
                                                                 ...prev,
                                                                 environment: { ...prev.environment, [envKey]: newList }
                                                              }));
                                                           }}
                                                           className="flex items-center gap-1.5 px-3 py-1 bg-[#3E8ED0]/10 hover:bg-[#3E8ED0] text-[#3E8ED0] hover:text-white rounded border border-[#3E8ED0]/30 transition-all text-[11px] font-bold"
                                                        >
                                                           <Plus className="w-3 h-3" /> Add Mod
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
          </div>
        </div>
      )}
    </div>
  );
}
