import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, getStoredToken, setStoredToken } from "../api/client";
import type { Bootstrap, User } from "../types";

type RegisterInput = {
  role: "client" | "performer";
  phone: string;
  email?: string;
  password: string;
  displayName: string;
  cityId: string;
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
