"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import {
  useAuth as useClerkAuth,
  useUser,
  useClerk,
} from "@clerk/nextjs";
import type { UserInfo } from "../../shared/events";
import { setTokenGetter } from "../lib/api";

interface AuthContext {
  user: UserInfo | null;
  token: string | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthContext>({
  user: null,
  token: null,
  loading: true,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const { user: clerkUser } = useUser();
  const { signOut } = useClerk();

  useEffect(() => {
    setTokenGetter(async () => {
      if (!isSignedIn) return null;
      try {
        return (await getToken()) || null;
      } catch {
        return null;
      }
    });
  }, [getToken, isSignedIn]);

  const user: UserInfo | null =
    isLoaded && isSignedIn && clerkUser
      ? {
          id: clerkUser.id,
          email:
            clerkUser.primaryEmailAddress?.emailAddress ||
            clerkUser.emailAddresses[0]?.emailAddress ||
            "",
          name:
            clerkUser.fullName ||
            clerkUser.firstName ||
            clerkUser.username ||
            "User",
        }
      : null;

  const logout = useCallback(async () => {
    await signOut({ redirectUrl: "/" });
  }, [signOut]);

  return (
    <Ctx.Provider
      value={{
        user,
        token: null,
        loading: !isLoaded,
        logout,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
