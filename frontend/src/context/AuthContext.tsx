import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, getStoredToken, setStoredToken } from "../api/client";
import type { Bootstrap, User } from "../types";

type RegisterInput = {
  role: "client" | "performer";
  phone: string;
  email?: string;
  password: string;
  displayName: string;
  cityId?: string;
  citySuggestion?: { name: string; region?: string };
  acceptedConsentTypes: string[];
  acceptedLegalDocumentTypes?: string[];
  marketingNotificationsAccepted?: boolean;
  dependentDataTransferConfirmed?: boolean;
  helperNotEmployerAcknowledged?: boolean;
  helperNoMedicalServicesConfirmed?: boolean;
};

type AuthContextValue = {
  user: User | null;
  token: string | null;
  bootstrap: Bootstrap | null;
  isLoading: boolean;
  refreshMe: () => Promise<void>;
  login: (phoneOrEmail: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  claimOAuthSession: () => Promise<{ profileComplete: boolean; nextPath: string }>;
  cancelOAuth: () => Promise<void>;
  completeOAuthProfile: (input: Parameters<typeof api.completeOAuthProfile>[0]) => Promise<{ nextPath: string }>;
  startActing: (role: "customer" | "helper") => Promise<{ nextPath: string }>;
  stopActing: () => Promise<{ nextPath: string }>;
  acceptReplacementToken: (token: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const bootstrapPayload = await api.bootstrap();
        let mePayload: { user: User } | null = null;
        if (token) {
          try {
            mePayload = await api.me();
          } catch {
            setStoredToken(null);
            if (!ignore) {
              setToken(null);
              setUser(null);
            }
          }
        }
        if (!ignore) {
          setBootstrap(bootstrapPayload);
          if (mePayload) setUser(mePayload.user);
        }
      } finally {
        if (!ignore) setIsLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      bootstrap,
      isLoading,
      async refreshMe() {
        const payload = await api.me();
        setUser(payload.user);
      },
      async login(phoneOrEmail, password) {
        const payload = await api.login({ phoneOrEmail, password });
        setStoredToken(payload.token);
        setToken(payload.token);
        setUser(payload.user);
      },
      async register(input) {
        const payload = await api.register(input);
        setStoredToken(payload.token);
        setToken(payload.token);
        setUser(payload.user);
      },
      async claimOAuthSession() {
        const payload = await api.claimOAuthSession();
        setStoredToken(payload.token);
        setToken(payload.token);
        setUser(payload.user);
        return { profileComplete: payload.profileComplete, nextPath: payload.nextPath };
      },
      async cancelOAuth() {
        try {
          await api.cancelOAuth();
        } finally {
          setStoredToken(null);
          setToken(null);
          setUser(null);
        }
      },
      async completeOAuthProfile(input) {
        const payload = await api.completeOAuthProfile(input);
        setUser(payload.user);
        return { nextPath: payload.nextPath };
      },
      async startActing(role) {
        const payload = await api.startAdminActing(role);
        setStoredToken(payload.token);
        const mePayload = await api.me();
        setToken(payload.token);
        setUser(mePayload.user);
        return { nextPath: payload.nextPath };
      },
      async stopActing() {
        const payload = await api.stopAdminActing();
        setStoredToken(payload.token);
        const mePayload = await api.me();
        setToken(payload.token);
        setUser(mePayload.user);
        return { nextPath: payload.nextPath };
      },
      async acceptReplacementToken(nextToken) {
        setStoredToken(nextToken);
        setToken(nextToken);
        const payload = await api.me();
        setUser(payload.user);
      },
      logout() {
        setStoredToken(null);
        setToken(null);
        setUser(null);
      }
    }),
    [bootstrap, isLoading, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
