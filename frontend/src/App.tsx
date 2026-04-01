import { useEffect, useState } from "react";
import { Folder, Play, Square, Settings, RefreshCw, Server, AlertCircle } from "lucide-react";

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

  const fetchInstances = async () => {
    try {
      const res = await fetch("http://localhost:8000/api/instances");
      const data = await res.json();
      setInstances(data);
      
      // Fetch status for each valid one
      for (const inst of data) {
        if (inst.has_compose) {
          fetchStatus(inst.id);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchStatus = async (id: string) => {
    try {
      const res = await fetch(`http://localhost:8000/api/instances/${id}/status`);
      const data = await res.json();
      setStatuses(prev => ({ ...prev, [id]: data }));
    } catch (e) {
      console.error(e);
    }
  };

  const handleStart = async (id: string) => {
    try {
      await fetch(`http://localhost:8000/api/instances/${id}/start`, { method: "POST" });
      setTimeout(() => fetchStatus(id), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  const handleStop = async (id: string) => {
    try {
      await fetch(`http://localhost:8000/api/instances/${id}/stop`, { method: "POST" });
      setTimeout(() => fetchStatus(id), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchInstances();
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-8 font-sans selection:bg-indigo-500/30">
      <header className="max-w-6xl mx-auto mb-12 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20">
            <Server className="text-white w-6 h-6" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white to-neutral-400 bg-clip-text text-transparent">
            Isopod
          </h1>
        </div>
        <button 
          onClick={fetchInstances}
          className="flex items-center gap-2 px-4 py-2 bg-neutral-900 hover:bg-neutral-800 transition-colors border border-neutral-800 rounded-lg text-sm font-medium"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </header>
      
      <main className="max-w-6xl mx-auto">
        {loading ? (
          <div className="flex animate-pulse space-x-4">
            <div className="flex-1 space-y-4 py-1">
              <div className="h-4 bg-neutral-800 rounded w-3/4"></div>
              <div className="space-y-3">
                <div className="h-4 bg-neutral-800 rounded"></div>
                <div className="h-4 bg-neutral-800 rounded w-5/6"></div>
              </div>
            </div>
          </div>
        ) : instances.length === 0 ? (
          <div className="text-center py-24 border border-dashed border-neutral-800 rounded-2xl bg-neutral-900/50 flex flex-col items-center justify-center">
             <AlertCircle className="w-12 h-12 text-neutral-500 mb-4" />
             <h3 className="text-xl font-medium text-neutral-300">No Instances Found</h3>
             <p className="text-neutral-500 mt-2 max-w-sm">Create a folder in your configured SERVERS_DIR to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {instances.map((inst) => {
              const statusInfo = statuses[inst.id];
              const isRunning = statusInfo?.is_running;
              
              return (
                <div key={inst.id} className="group relative bg-neutral-900/80 backdrop-blur-xl border border-neutral-800/80 rounded-2xl p-6 transition-all duration-300 hover:shadow-2xl hover:shadow-indigo-500/10 hover:-translate-y-1 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  
                  <div className="relative z-10">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-neutral-800 rounded-lg">
                           <Folder className="w-6 h-6 text-indigo-400" />
                        </div>
                        <div>
                          <h2 className="text-xl font-semibold text-white tracking-wide">{inst.name}</h2>
                          <div className="flex items-center gap-2 mt-1">
                             {isRunning ? (
                               <div className="flex items-center gap-1.5 cursor-help" title="Containers are actively running">
                                 <span className="relative flex h-2.5 w-2.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                                 </span>
                                 <span className="text-xs text-emerald-400 font-medium tracking-wide uppercase">Running</span>
                               </div>
                             ) : (
                               <div className="flex items-center gap-1.5 cursor-help" title="Valid instance configuration detected">
                                  <span className="w-2.5 h-2.5 rounded-full bg-neutral-700"></span>
                                  <span className="text-xs text-neutral-500 font-medium tracking-wide uppercase">Valid</span>
                               </div>
                             )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-6 mt-6 border-t border-neutral-800 flex items-center gap-3">
                      {isRunning ? (
                        <button 
                          onClick={() => handleStop(inst.id)}
                          className="flex-1 flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500 px-4 py-2.5 rounded-xl font-medium transition-colors"
                        >
                          <Square className="w-4 h-4" /> Stop
                        </button>
                      ) : (
                        <button 
                          onClick={() => handleStart(inst.id)}
                          className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-xl font-medium transition-colors shadow-lg shadow-indigo-600/20"
                        >
                          <Play className="w-4 h-4 fill-current" /> Start
                        </button>
                      )}
                      
                      <button className="p-2.5 text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors">
                        <Settings className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
