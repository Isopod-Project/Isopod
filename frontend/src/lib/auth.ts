import { createContext, useContext } from "react";

export type AuthContextValue = { username: string | null; logout: () => Promise<void> };

export const AuthContext = createContext<AuthContextValue>({ username: null, logout: async () => {} });

/** The logged-in admin and a logout action, provided by AuthGate. */
export const useAuth = () => useContext(AuthContext);
