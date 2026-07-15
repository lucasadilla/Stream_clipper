"use client";

import { useEffect, useState } from "react";

interface BetaCodeRow {
  id: string;
  name: string;
  intendedFor: string | null;
  codeHint: string;
  active: boolean;
  used: boolean;
  usedBy: { id: string; email: string | null; displayName: string | null } | null;
  usedAt: string | null;
  expiresAt: string | null;
  notes: string | null;
  createdAt: string;
}

export default function CreatorBetaAdminPage() {
  const [secret, setSecret] = useState("");
  const [name, setName] = useState("");
  const [intendedFor, setIntendedFor] = useState("");
  const [count, setCount] = useState(1);
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [codes, setCodes] = useState<BetaCodeRow[]>([]);
  const [privateCodes, setPrivateCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSecret(window.sessionStorage.getItem("creatorBetaAdminSecret") ?? "");
  }, []);

  async function loadCodes(overrideSecret?: string) {
    const value = overrideSecret ?? secret;
    if (!value) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/creator-beta/admin/codes", {
        headers: { "x-creator-beta-admin-secret": value },
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Owner access failed");
      window.sessionStorage.setItem("creatorBetaAdminSecret", value);
      setCodes(body.codes ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load codes");
    } finally {
      setLoading(false);
    }
  }

  async function createCode(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setPrivateCodes([]);
    try {
      const response = await fetch("/api/creator-beta/admin/codes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-creator-beta-admin-secret": secret,
        },
        body: JSON.stringify({
          name,
          intendedFor: intendedFor || null,
          count,
          notes: notes || null,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not create code");
      const minted: string[] =
        body.privateCodes ??
        (body.privateCode ? [body.privateCode] : []);
      setPrivateCodes(minted);
      setName("");
      setIntendedFor("");
      setCount(1);
      setExpiresAt("");
      setNotes("");
      await loadCodes();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create code");
    } finally {
      setLoading(false);
    }
  }

  async function toggleCode(item: BetaCodeRow) {
    setError(null);
    try {
      const response = await fetch(`/api/creator-beta/admin/codes/${item.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-creator-beta-admin-secret": secret,
        },
        body: JSON.stringify({ active: !item.active }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not update code");
      setCodes((current) =>
        current.map((code) =>
          code.id === item.id ? { ...code, active: !item.active } : code
        )
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update code");
    }
  }

  return (
    <main className="min-h-screen bg-[#020302] text-white">
      <section className="border-b border-[#20271e]">
        <div className="mx-auto max-w-[1280px] px-4 py-12 sm:px-7">
          <p className="font-mono text-[9px] font-bold uppercase text-[#95ff00]">
            Owner controls
          </p>
          <h1 className="mt-3 text-4xl font-bold sm:text-6xl">
            Creator Program codes
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[#8f9a89]">
            Mint one-time codes for select creators. Codes are hashed at rest;
            full values are shown only once so you can DM them privately.
          </p>
        </div>
      </section>

      <section className="border-b border-[#20271e]">
        <div className="mx-auto grid max-w-[1280px] gap-8 px-4 py-8 sm:px-7 lg:grid-cols-[0.7fr_1.3fr]">
          <div>
            <label className="block space-y-2">
              <span className="font-mono text-[9px] font-bold uppercase text-[#788273]">
                Owner secret
              </span>
              <input
                type="password"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                placeholder="CREATOR_BETA_ADMIN_SECRET"
                className="h-11 w-full border border-[#34402f] bg-[#050705] px-3 text-sm outline-none focus:border-[#95ff00]"
              />
            </label>
            <button
              type="button"
              onClick={() => void loadCodes()}
              disabled={!secret || loading}
              className="mt-3 bg-[#95ff00] px-4 py-2.5 text-xs font-black text-black disabled:opacity-40"
            >
              {loading ? "Loading..." : "Unlock manager"}
            </button>
          </div>

          <form
            onSubmit={(event) => void createCode(event)}
            className="grid gap-4 border-l border-[#20271e] pl-0 lg:pl-8"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2">
                <span className="font-mono text-[9px] font-bold uppercase text-[#788273]">
                  Batch label
                </span>
                <input
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="March creator drop"
                  className="h-11 w-full border border-[#34402f] bg-[#050705] px-3 text-sm outline-none focus:border-[#95ff00]"
                />
              </label>
              <label className="block space-y-2">
                <span className="font-mono text-[9px] font-bold uppercase text-[#788273]">
                  Intended creator
                </span>
                <input
                  value={intendedFor}
                  onChange={(event) => setIntendedFor(event.target.value)}
                  placeholder="@handle or email"
                  className="h-11 w-full border border-[#34402f] bg-[#050705] px-3 text-sm outline-none focus:border-[#95ff00]"
                />
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2">
                <span className="font-mono text-[9px] font-bold uppercase text-[#788273]">
                  How many codes
                </span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={count}
                  onChange={(event) =>
                    setCount(Math.max(1, Math.min(50, Number(event.target.value) || 1)))
                  }
                  className="h-11 w-full border border-[#34402f] bg-[#050705] px-3 text-sm outline-none focus:border-[#95ff00]"
                />
              </label>
              <label className="block space-y-2">
                <span className="font-mono text-[9px] font-bold uppercase text-[#788273]">
                  Expiration / optional
                </span>
                <input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                  className="h-11 w-full border border-[#34402f] bg-[#050705] px-3 text-sm outline-none focus:border-[#95ff00]"
                />
              </label>
            </div>
            <label className="block space-y-2">
              <span className="font-mono text-[9px] font-bold uppercase text-[#788273]">
                Notes / optional
              </span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                className="w-full resize-y border border-[#34402f] bg-[#050705] px-3 py-2 text-sm outline-none focus:border-[#95ff00]"
              />
            </label>
            <button
              type="submit"
              disabled={!secret || !name.trim() || loading}
              className="w-fit bg-[#95ff00] px-5 py-3 text-xs font-black text-black disabled:opacity-40"
            >
              Mint {count > 1 ? `${count} codes` : "private code"}
            </button>
          </form>
        </div>
      </section>

      <section className="mx-auto max-w-[1280px] px-4 py-8 sm:px-7">
        {privateCodes.length > 0 && (
          <div className="mb-8 border-2 border-[#95ff00] bg-[#0a1008] p-5">
            <p className="font-mono text-[9px] font-bold uppercase text-[#95ff00]">
              New private code{privateCodes.length > 1 ? "s" : ""} / shown once
            </p>
            <ul className="mt-3 space-y-2">
              {privateCodes.map((code) => (
                <li key={code}>
                  <code className="text-lg font-bold text-white sm:text-xl">
                    {code}
                  </code>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(privateCodes.join("\n"));
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
              className="mt-4 border border-[#95ff00] px-3 py-2 text-xs font-bold text-[#95ff00]"
            >
              {copied ? "Copied" : "Copy all"}
            </button>
          </div>
        )}

        {error && (
          <p className="mb-5 border-l-2 border-[#ff756b] bg-[#170a09] px-4 py-3 text-sm text-[#ff8d84]">
            {error}
          </p>
        )}

        <div className="overflow-x-auto border border-[#20271e]">
          <table className="w-full min-w-[980px] border-collapse text-left">
            <thead className="bg-[#080b08] font-mono text-[9px] uppercase text-[#778171]">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">For</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3">Used by</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-4 py-3">Control</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((item) => (
                <tr
                  key={item.id}
                  className="border-t border-[#20271e] text-xs text-[#c2cbbd]"
                >
                  <td className="px-4 py-4 font-bold text-white">{item.name}</td>
                  <td className="px-4 py-4">{item.intendedFor || "-"}</td>
                  <td className="px-4 py-4 font-mono">{item.codeHint}</td>
                  <td className="px-4 py-4">
                    <span
                      className={
                        item.active ? "text-[#95ff00]" : "text-[#ff8d84]"
                      }
                    >
                      {item.active ? "Active" : "Paused"}
                    </span>
                    {item.used ? " / Used" : " / Available"}
                  </td>
                  <td className="px-4 py-4">
                    {item.usedBy?.displayName || item.usedBy?.email || "-"}
                  </td>
                  <td className="px-4 py-4">
                    {item.expiresAt
                      ? new Date(item.expiresAt).toLocaleString()
                      : "Never"}
                  </td>
                  <td className="max-w-48 px-4 py-4 text-[#7f8979]">
                    {item.notes || "-"}
                  </td>
                  <td className="px-4 py-4">
                    <button
                      type="button"
                      onClick={() => void toggleCode(item)}
                      disabled={item.used}
                      className="border border-[#34402f] px-3 py-2 font-bold hover:border-[#95ff00] disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      {item.active ? "Pause" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
              {codes.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-sm text-[#6f796a]"
                  >
                    Enter the owner secret to load codes.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
