import { useEffect, useState } from "react";
import { Folder, Play, Square, Settings, Plus, RefreshCw, Layers, Gamepad2, AlertCircle, Edit, Trash2 } from "lucide-react";

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
  containers: any[];
}

export default function App() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [statuses, setStatuses] = useState<Record<string, InstanceStatus>>({});
  const [loading, setLoading] = useState(true);
  
  // Selected Instance for the right sidebar
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchInstances = async () => {
    try {
      const res = await fetch("/api/instances");
      if (!res.ok) throw new Error("Backend error");
      const data = await res.json();
      setInstances(data);
      
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
      setStatuses(prev => ({ ...prev, [id]: data }));
    } catch (e) {
      console.error(e);
    }
  };

  const handleStart = async (id: string) => {
    try {
      setStatuses(prev => ({ 
        ...prev, 
        [id]: { ...prev[id], is_running: true } // Optimistic update
      }));
      await fetch(`/api/instances/${id}/start`, { method: "POST" });
      setTimeout(() => fetchStatus(id), 2000);
    } catch (e) {
      console.error(e);
      alert("Error starting container");
    }
  };

  const handleStop = async (id: string) => {
    try {
      setStatuses(prev => ({ 
        ...prev, 
        [id]: { ...prev[id], is_running: false } // Optimistic update
      }));
      await fetch(`/api/instances/${id}/stop`, { method: "POST" });
      setTimeout(() => fetchStatus(id), 2000);
    } catch (e) {
      console.error(e);
      alert("Error stopping container");
    }
  };

  useEffect(() => {
    fetchInstances();
    
    // Poll for status every 5 seconds
    const interval = setInterval(() => {
        setInstances(prevInstances => {
            prevInstances.forEach(inst => fetchStatus(inst.id));
            return prevInstances;
        });
    }, 5000);
    
    return () => clearInterval(interval);
  }, []);

  const selectedInstance = instances.find(i => i.id === selectedId);
  const selectedStatus = selectedId ? statuses[selectedId] : null;

  return (
    <div className="flex h-screen bg-[#242424] text-[#E0E0E0] font-sans selection:bg-[#3E8ED0]/40 overflow-hidden">
      
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Top Navbar */}
        <header className="h-[52px] min-h-[52px] bg-[#3B3B3B] border-b border-[#1E1E1E] flex items-center px-4 gap-4 flex-shrink-0 shadow-sm z-10">
          <button className="flex items-center gap-2 hover:bg-[#4A4A4A] px-3 py-1.5 rounded transition-colors text-sm font-medium">
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
        
        {/* Instances Grid */}
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
              
              {/* Prism Launcher style Grid */}
              <div className="flex flex-wrap gap-4">
                {instances.map((inst) => {
                  const isSelected = selectedId === inst.id;
                  const isRunning = statuses[inst.id]?.is_running;
                  
                  return (
                    <div 
                      key={inst.id}
                      onClick={() => setSelectedId(inst.id)}
                      className={`flex flex-col flex-wrap items-center justify-center p-3 rounded cursor-pointer transition-all w-[110px] select-none ${
                        isSelected 
                          ? 'bg-[#3E8ED0]/20 outline outline-2 outline-[#3E8ED0] shadow-sm' 
                          : 'hover:bg-[#404040] border border-transparent'
                      }`}
                    >
                      <div className="relative mb-3 flex items-center justify-center w-[72px] h-[72px] bg-[#3B3B3B] rounded shadow-inner">
                        <Gamepad2 className={`w-10 h-10 ${isRunning ? 'text-emerald-400' : 'text-[#878787]'}`} />
                        {/* Status Dot */}
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

      {/* Right Sidebar */}
      <aside className="w-[280px] min-w-[280px] flex-shrink-0 bg-[#242424] border-l border-[#1E1E1E] flex flex-col shadow-[rgba(0,0,0,0.1)_-4px_0px_15px_-3px] z-20">
        {selectedInstance ? (
          <>
            {/* Sidebar Header: Large Icon and Title */}
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

            {/* Sidebar Actions */}
            <div className="p-4 flex flex-col gap-1.5 flex-1 overflow-auto">
              
              {selectedStatus?.is_running ? (
                <button 
                  onClick={() => handleStop(selectedInstance.id)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded bg-[#402020] hover:bg-[#5A2525] border border-[#502020] text-red-400 transition-colors"
                >
                  <Square className="w-4 h-4 fill-current" />
                  <span className="font-semibold">Kill</span>
                </button>
              ) : (
                <button 
                  onClick={() => handleStart(selectedInstance.id)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded bg-[#1A3A22] hover:bg-[#204A2A] border border-[#2A5030] text-emerald-400 transition-colors"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span className="font-semibold">Launch</span>
                </button>
              )}

              <div className="h-px bg-[#323232] my-2"></div>
              
              <button className="flex items-center gap-3 px-3 py-1.5 rounded hover:bg-[#323232] text-neutral-300 transition-colors">
                <Edit className="w-4 h-4" /> Edit
              </button>
              <button className="flex items-center gap-3 px-3 py-1.5 rounded hover:bg-[#323232] text-neutral-300 transition-colors">
                <Folder className="w-4 h-4" /> Folder
              </button>
              <button className="flex items-center gap-3 px-3 py-1.5 rounded hover:bg-[#323232] text-neutral-300 transition-colors">
                <Settings className="w-4 h-4" /> Settings
              </button>
              <div className="h-px bg-[#323232] my-2"></div>
              <button className="flex items-center gap-3 px-3 py-1.5 rounded hover:bg-[#3D2525] text-red-400/80 transition-colors">
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

    </div>
  );
}
