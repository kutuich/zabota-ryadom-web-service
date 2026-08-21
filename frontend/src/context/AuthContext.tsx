import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, setAccessToken } from "../api/client";
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
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const bootstrapPayload = await api.bootstrap();
        let mePayload: { user: User } | null = null;
        const restoredToken = await api.refreshSession();
        if (restoredToken) {
          mePayload = await api.me().catch(() => null);
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
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      bootstrap,
      isLoading,
      async refreshMe() {
        const payload = await api.me();
        setUser(payload.user);
      },
      async login(phoneOrEmail, password) {
        const payload = await api.login({ phoneOrEmail, password });
        setAccessToken(payload.token);
        setUser(payload.user);
      },
      async register(input) {
        const payload = await api.register(input);
        setAccessToken(payload.token);
        setUser(payload.user);
      },
      async claimOAuthSession() {
        const payload = await api.claimOAuthSession();
        setAccessToken(payload.token);
        setUser(payload.user);
        return { profileComplete: payload.profileComplete, nextPath: payload.nextPath };
      },
      async cancelOAuth() {
        try {
          await api.cancelOAuth();
        } finally {
          setAccessToken(null);
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
        setAccessToken(payload.token);
        const mePayload = await api.me();
        setUser(mePayload.user);
        return { nextPath: payload.nextPath };
      },
      async stopActing() {
        const payload = await api.stopAdminActing();
        setAccessToken(payload.token);
        const mePayload = await api.me();
        setUser(mePayload.user);
        return { nextPath: payload.nextPath };
      },
      async acceptReplacementToken(nextToken) {
        setAccessToken(nextToken);
        const payload = await api.me();
        setUser(payload.user);
      },
      async logout() {
        try {
          await api.logout();
        } finally {
          setAccessToken(null);
          setUser(null);
        }
      }
    }),
    [bootstrap, isLoading, user]
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
