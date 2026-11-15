import { createContext } from "react";

export interface AuthUser {
  id?: number;
  name: string;
  email: string;
  initials: string;
  role: "admin" | "user";
}

export interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password?: string, name?: string, role?: "admin" | "user") => Promise<void>;
  register: (name: string, email: string, password?: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
