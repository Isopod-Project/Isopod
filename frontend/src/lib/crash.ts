// Crash status as reported by the backend's /status endpoint.
export interface CrashInfo {
   state: "crashed" | "restarting" | "halted" | "recovered";
   time?: number;
   exit_code?: number | null;
   oom_killed?: boolean;
   count?: number;
}

/** Short status text for a crash, e.g. "Crashed (Code: 1)". */
export const crashLabel = (crash: CrashInfo) => {
   if (crash.state === "halted") return "Crash loop stopped";
   if (crash.state === "restarting") return "Restarting after crash";
   if (crash.state === "recovered") return "Recovered from crash";
   return crash.oom_killed ? "Out of memory" : `Crashed (Code: ${crash.exit_code ?? "?"})`;
};

/** What happened, in a sentence, for the sidebar banner. */
export const crashSummary = (crash: CrashInfo) => {
   const cause = crash.oom_killed ? "ran out of memory" : `stopped unexpectedly (exit code ${crash.exit_code ?? "unknown"})`;
   const when = crash.time ? ` at ${new Date(crash.time * 1000).toLocaleTimeString()}` : "";
   if (crash.state === "halted") {
      return `The server crashed ${crash.count ?? "several"} times within 2 minutes, so Isopod stopped restarting it. Check the crash report, then start it again when it's fixed.`;
   }
   if (crash.state === "recovered") return `The server ${cause}${when} and was restarted automatically.`;
   if (crash.state === "restarting") return `The server ${cause}${when}. Docker is restarting it.`;
   return `The server ${cause}${when}.`;
};
