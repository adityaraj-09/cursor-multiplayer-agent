"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { UserInfo } from "../../shared/events";
import {
  getStoredUser,
  getStoredToken,
  fetchMe,
  login as apiLogin,
  register as apiRegister,
  logout as apiLogout,
  storeAuth,
  clearAuth,
} from "../lib/api";

interface AuthContext {
  user: UserInfo | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthContext>({
  user: null,
  token: null,
  loading: true,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = getStoredUser();
    const storedToken = getStoredToken();
    if (stored && storedToken) {
      setUser(stored);
      setToken(storedToken);
      fetchMe().then((u) => {
        if (u) {
          setUser(u);
        } else {
          clearAuth();
          setUser(null);
          setToken(null);
        }
      }).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user: u, token: t } = await apiLogin(email, password);
    setUser(u);
    setToken(t);
  }, []);

  const register = useCallback(
    async (email: string, name: string, password: string) => {
      const { user: u, token: t } = await apiRegister(email, name, password);
      setUser(u);
      setToken(t);
    },
    [],
  );

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
    setToken(null);
  }, []);

  return (
    <Ctx.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
