"use client";

import { useState } from "react";
import Link from "next/link";
import Logo from "./Logo";
import { ARCSCAN, switchToArc } from "@/lib/arcNetwork";

interface HeaderProps {
  account: string;
  balance: string;
  chainOk: boolean;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

export default function Header({ account, balance, chainOk, connecting, onConnect, onDisconnect }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [justCopied, setJustCopied] = useState(false);

  const toggleMenu = () => setMenuOpen((prev) => !prev);
  const closeMenu = () => setMenuOpen(false);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(account);
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 1400);
    } catch {
      // clipboard unavailable in this context
    }
  }

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(11, 10, 12, 0.74)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: "15px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 11, textDecoration: "none" }}>
          <Logo size={27} />
          <span className="serif" style={{ fontSize: 22, fontWeight: 800, letterSpacing: "0.01em" }}>
            Ink<span className="italic" style={{ color: "var(--red)" }}>Fuse</span>
          </span>
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 9, justifyContent: "flex-end", minWidth: 0 }}>
          {account ? (
            <div style={{ position: "relative" }}>
              <button onClick={toggleMenu} className="wtag">
                <span className="dot" style={{ background: chainOk ? "var(--red)" : "#ff5a4d" }} />
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{account.slice(0, 5)}…{account.slice(-4)}</span>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" style={{ transform: menuOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease", opacity: 0.6 }}>
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {menuOpen ? (
                <>
                  <div onClick={closeMenu} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
                  <div className="panel" style={{ position: "absolute", top: "calc(100% + 9px)", right: 0, zIndex: 61, minWidth: 250, overflow: "hidden", boxShadow: "0 20px 50px -16px rgba(0,0,0,0.8)" }}>
                    <div style={{ padding: "14px 15px" }}>
                      <div className="serif italic" style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>Connected</div>
                      <div className="num" style={{ fontSize: 14, color: "var(--bone)" }}>{account.slice(0, 13)}…{account.slice(-6)}</div>
                      <div className="num" style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>{balance || "0"} USDC</div>
                    </div>
                    <div className="ink-row--meta">
                      <span>Network</span>
                      {chainOk ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--bone)", fontWeight: 600 }}>
                          <span className="dot" style={{ background: "var(--red)" }} /> ARC Testnet
                        </span>
                      ) : (
                        <button onClick={() => switchToArc().catch(() => {})} style={{ background: "none", border: "none", color: "#ff5a4d", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5 }}>
                          Wrong — switch ↗
                        </button>
                      )}
                    </div>
                    <button className="ink-row" onClick={copyAddress}>{justCopied ? "Copied ✓" : "Copy address"}</button>
                    <a className="ink-row" href={`${ARCSCAN}/address/${account}`} target="_blank" rel="noopener noreferrer" onClick={closeMenu}>View on ArcScan ↗</a>
                    <button className="ink-row danger" onClick={() => { closeMenu(); onDisconnect(); }}>Disconnect</button>
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <button onClick={onConnect} disabled={connecting} className="btn btn--red">
              {connecting ? "Opening…" : "Open wallet"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
