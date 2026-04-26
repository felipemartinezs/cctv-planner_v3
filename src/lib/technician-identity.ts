import { useCallback, useEffect, useState } from "react";
import type { TechnicianIdentity } from "../types";

const STORAGE_KEY = "cctv-technician-identity-v1";

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `tech_${crypto.randomUUID()}`;
  }
  return `tech_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function computeInitials(name: string): string {
  const tokens = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) {
    return "??";
  }
  if (tokens.length === 1) {
    return tokens[0].slice(0, 2).toUpperCase();
  }
  const first = tokens[0][0] || "";
  const last = tokens[tokens.length - 1][0] || "";
  return `${first}${last}`.toUpperCase();
}

export function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export function shortDisplayName(name: string): string {
  const trimmed = normalizeName(name);
  const tokens = trimmed.split(" ").filter(Boolean);
  if (tokens.length === 0) {
    return "";
  }
  if (tokens.length === 1) {
    return tokens[0];
  }
  return `${tokens[0]} ${tokens[tokens.length - 1][0]}.`;
}

export function buildIdentity(rawName: string, existing?: TechnicianIdentity | null): TechnicianIdentity | null {
  const name = normalizeName(rawName);
  if (name.length < 2) {
    return null;
  }
  return {
    id: existing?.id || generateId(),
    name,
    initials: computeInitials(name),
  };
}

function readIdentityFromStorage(): TechnicianIdentity | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<TechnicianIdentity>;
    if (
      parsed &&
      typeof parsed.id === "string" &&
      typeof parsed.name === "string" &&
      parsed.id.length > 0 &&
      parsed.name.trim().length > 0
    ) {
      return {
        id: parsed.id,
        name: parsed.name,
        initials:
          typeof parsed.initials === "string" && parsed.initials.length > 0
            ? parsed.initials
            : computeInitials(parsed.name),
      };
    }
  } catch (error) {
    console.warn("[technician-identity] Failed to read identity from storage:", error);
  }
  return null;
}

function writeIdentityToStorage(identity: TechnicianIdentity | null): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (identity) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch (error) {
    console.warn("[technician-identity] Failed to write identity to storage:", error);
  }
}

export interface UseTechnicianIdentityResult {
  identity: TechnicianIdentity | null;
  isReady: boolean;
  setIdentityFromName: (name: string) => TechnicianIdentity | null;
  clearIdentity: () => void;
}

export function useTechnicianIdentity(): UseTechnicianIdentityResult {
  const [identity, setIdentity] = useState<TechnicianIdentity | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setIdentity(readIdentityFromStorage());
    setIsReady(true);
  }, []);

  const setIdentityFromName = useCallback((name: string) => {
    setIdentity((current) => {
      const next = buildIdentity(name, current);
      if (next) {
        writeIdentityToStorage(next);
        return next;
      }
      return current;
    });
    const next = buildIdentity(name, identity);
    return next;
  }, [identity]);

  const clearIdentity = useCallback(() => {
    writeIdentityToStorage(null);
    setIdentity(null);
  }, []);

  return { identity, isReady, setIdentityFromName, clearIdentity };
}
