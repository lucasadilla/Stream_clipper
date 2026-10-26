"use client";
import { useEffect } from "react";

export const LAST_SESSION_KEY = "clipper:last-session";
export function RememberSession({ id }: { id: string }) {
  useEffect(() => {
    try { localStorage.setItem(LAST_SESSION_KEY, id); } catch { /* Resume also works without browser storage. */ }
  }, [id]);
  return null;
}
