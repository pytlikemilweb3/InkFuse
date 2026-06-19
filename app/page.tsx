"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ethers } from "ethers";
import Header from "@/components/Header";
import { SketchCard, PieceCard } from "@/components/Cards";
import { useWallet } from "@/lib/useWallet";
import { ARCSCAN, switchToArc } from "@/lib/arcNetwork";
import { pickProvider } from "@/lib/wallet";
import {
  CONTRACT_ADDRESS,
  INKFUSE_ABI,
  hasContract,
  readContract,
  fetchGlobal,
  fetchSketches,
  fetchListings,
  fetchCollection,
  fetchSketchesOf,
  fetchArtistEarned,
  fmtUsdc,
  shortAddr,
  looksLikeUrl,
  EMPTY_GLOBAL,
  type Sketch,
  type Piece,
  type Global,
} from "@/lib/inkfuse";

type Tab = "gallery" | "market" | "mine";

export default function Home() {
  const { account, balance, chainOk, connecting, connect, disconnect, refreshBalance } = useWallet();

  const [global, setGlobal] = useState<Global>(EMPTY_GLOBAL);
  const [sketches, setSketches] = useState<Sketch[]>([]);
  const [listings, setListings] = useState<Piece[]>([]);
  const [collection, setCollection] = useState<Piece[]>([]);
  const [myDrops, setMyDrops] = useState<Sketch[]>([]);
  const [earned, setEarned] = useState<bigint>(0n);
  const [tab, setTab] = useState<Tab>("gallery");

  // drop form
  const [uri, setUri] = useState("");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("1");
  const [cap, setCap] = useState("");
  const [roy, setRoy] = useState("10");
  const [dropMsg, setDropMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  const loadEpoch = useRef(0);
  const accountRef = useRef(account);
  const inFlight = useRef(false);

  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  const load = useCallback(async () => {
    if (!hasContract()) return;
    const epoch = ++loadEpoch.current;
    try {
      const c = readContract();
      const [g, sk, ls] = await Promise.all([fetchGlobal(c), fetchSketches(c), fetchListings(c)]);
      if (epoch !== loadEpoch.current) return;
      setGlobal(g);
      setSketches(sk);
      setListings(ls);
      if (account) {
        const [col, mine, ea] = await Promise.all([fetchCollection(account, c), fetchSketchesOf(account, c), fetchArtistEarned(account, c)]);
        if (epoch !== loadEpoch.current) return;
        setCollection(col);
        setMyDrops(mine);
        setEarned(ea);
      } else {
        setCollection([]);
        setMyDrops([]);
        setEarned(0n);
      }
    } catch {
      /* keep last good state */
    }
  }, [account]);

  useEffect(() => {
    load();
  }, [load]);

  async function writeContract() {
    const inj = pickProvider();
    if (!inj) throw new Error("No wallet found");
    await switchToArc(inj);
    const provider = new ethers.BrowserProvider(inj);
    const signer = await provider.getSigner(account);
    return new ethers.Contract(CONTRACT_ADDRESS, INKFUSE_ABI, signer);
  }

  function reason(e: unknown): string {
    const err = e as { code?: string | number; reason?: string; shortMessage?: string; message?: string };
    if (err?.code === "ACTION_REJECTED" || err?.code === 4001) return "Cancelled";
    return (err?.reason || err?.shortMessage || err?.message || "Failed").slice(0, 80);
  }

  function flash(key: string, text: string, hold = false) {
    setNote((n) => ({ ...n, [key]: text }));
    if (!hold) setTimeout(() => setNote((n) => { const m = { ...n }; delete m[key]; return m; }), 3000);
  }

  async function run(key: string, setMsg: (t: string) => void, fn: (c: ethers.Contract) => Promise<ethers.ContractTransactionResponse>, done: string) {
    if (!account) {
      if (!pickProvider()) return setMsg("✗ No wallet — install Rabby or MetaMask");
      connect();
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    const captured = account;
    setActiveKey(key);
    setMsg("Confirm in your wallet…");
    try {
      const c = await writeContract();
      const tx = await fn(c);
      setMsg("Settling on ARC…");
      await tx.wait();
      if (accountRef.current !== captured) return;
      setMsg(done);
      await load();
      await refreshBalance(captured);
    } catch (e) {
      setMsg("✗ " + reason(e));
    } finally {
      inFlight.current = false;
      setActiveKey(null);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) return setDropMsg("✗ Choose an image file");
    if (f.size > 4 * 1024 * 1024) return setDropMsg("✗ Image too large — max 4 MB (or paste a URL)");
    setUploading(true);
    setDropMsg("Uploading image…");
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const j = (await r.json()) as { url?: string; error?: string };
      if (!r.ok || !j.url) throw new Error(j.error || "failed");
      setUri(j.url);
      setDropMsg("✓ Image uploaded — set a title & price, then drop");
    } catch {
      setDropMsg("✗ Upload failed — paste an image URL instead");
    } finally {
      setUploading(false);
    }
  }

  // ── actions ──
  function dropSketch() {
    const u = uri.trim();
    const t = title.trim();
    const p = price.trim();
    if (!looksLikeUrl(u) || u.length > 400) return setDropMsg("✗ Paste a public image URL (https://…)");
    if (!t || t.length > 120) return setDropMsg("✗ Give the piece a title");
    if (!/^\d+(\.\d{1,6})?$/.test(p)) return setDropMsg("✗ Price must be a plain amount, e.g. 1 (0 = free)");
    const capN = cap.trim() === "" ? 0 : Number(cap);
    if (!Number.isInteger(capN) || capN < 0 || capN > 100000) return setDropMsg("✗ Editions must be a whole number (0 = open)");
    const royN = roy.trim() === "" ? 0 : Number(roy);
    if (isNaN(royN) || royN < 0 || royN > 20) return setDropMsg("✗ Royalty must be 0–20%");
    const bps = Math.round(royN * 100);
    if (royN > 0 && bps === 0) return setDropMsg("✗ Royalty too small — use at least 0.01%");
    const priceWei = ethers.parseEther(p);
    run("drop", setDropMsg, (c) => c.drop(u, t, priceWei, capN, bps), "✓ Dropped — it's in the gallery").then(() => {
      if (accountRef.current === account) {
        setUri("");
        setTitle("");
      }
    });
  }

  function collect(id: number, p: bigint) {
    run("s" + id, (t) => flash("s" + id, t, t.startsWith("Confirm") || t.startsWith("Settling")), (c) => c.collect(id, { value: p }), "✓ Collected");
  }
  function tip(id: number) {
    const amt = typeof window !== "undefined" ? window.prompt("Tip the artist — amount in USDC", "0.5") : null;
    if (amt === null) return;
    const a = amt.trim();
    if (!/^\d+(\.\d{1,6})?$/.test(a) || Number(a) <= 0) return flash("s" + id, "✗ Enter a USDC amount");
    run("s" + id, (t) => flash("s" + id, t, t.startsWith("Confirm") || t.startsWith("Settling")), (c) => c.tip(id, { value: ethers.parseEther(a) }), "✓ Tipped — thank the artist");
  }
  function buy(eid: number, p: bigint) {
    run("e" + eid, (t) => flash("e" + eid, t, t.startsWith("Confirm") || t.startsWith("Settling")), (c) => c.buy(eid, { value: p }), "✓ Bought — it's yours");
  }
  function listEd(eid: number, priceStr: string) {
    const p = priceStr.trim();
    if (!/^\d+(\.\d{1,6})?$/.test(p) || Number(p) <= 0) return flash("e" + eid, "✗ Set a resale price");
    run("e" + eid, (t) => flash("e" + eid, t, t.startsWith("Confirm") || t.startsWith("Settling")), (c) => c.list(eid, ethers.parseEther(p)), "✓ Listed for sale");
  }
  function delistEd(eid: number) {
    run("e" + eid, (t) => flash("e" + eid, t, t.startsWith("Confirm") || t.startsWith("Settling")), (c) => c.delist(eid), "✓ Delisted");
  }

  const wrap: React.CSSProperties = { maxWidth: 1180, margin: "0 auto", padding: "0 24px" };
  const mineCount = collection.length + myDrops.length;

  return (
    <div style={{ minHeight: "100vh", paddingBottom: 80 }}>
      <Header account={account} balance={balance} chainOk={chainOk} connecting={connecting} onConnect={connect} onDisconnect={disconnect} />

      {!hasContract() && (
        <div style={{ ...wrap, marginTop: 16 }}>
          <div className="panel-2" style={{ padding: "12px 16px", borderColor: "rgba(255,90,77,0.4)", color: "#ff5a4d", fontSize: 13.5 }}>
            Contract not wired in yet — deploy it from <a href="/deploy" style={{ color: "var(--red)", fontWeight: 700 }}>/deploy</a> and the house opens.
          </div>
        </div>
      )}

      {/* hero */}
      <section style={{ ...wrap, paddingTop: "clamp(40px, 6vw, 72px)" }}>
        <div className="rise" style={{ maxWidth: 880 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 22 }}>
            <span style={{ width: 40, height: 1, background: "var(--red)" }} />
            <span className="serif italic" style={{ fontSize: 14.5, color: "var(--bone-dim)" }}>An on-chain ink house · ARC Testnet</span>
          </div>
          <h1 className="display" style={{ fontSize: "clamp(44px, 8vw, 96px)" }}>
            Ink that keeps<br />
            <span className="italic" style={{ color: "var(--red)" }}>paying</span> its artist.
          </h1>
          <p style={{ fontSize: 18, color: "var(--bone-dim)", maxWidth: 600, lineHeight: 1.55, marginTop: 24 }}>
            Drop a sketch, collect it for a few cents of USDC, resell it with a royalty that routes home on
            its own, and tip the artist outright. Every payment is native, instant, multi-party — settled on
            Arc in one transaction, no token in sight.
          </p>
          <div style={{ display: "flex", gap: 11, marginTop: 28, flexWrap: "wrap" }}>
            <a href="#gallery" className="btn btn--red btn--lg">Explore the gallery</a>
            <a href="#drop" className="btn btn--lg">Drop a sketch</a>
          </div>
        </div>

        {/* economy */}
        <div className="figs" style={{ marginTop: 50 }}>
          {[
            { k: "primary sales", v: "$" + fmtUsdc(global.primary) },
            { k: "resale volume", v: "$" + fmtUsdc(global.secondary) },
            { k: "royalties routed", v: "$" + fmtUsdc(global.royalties) },
            { k: "tips sent", v: "$" + fmtUsdc(global.tips) },
          ].map((s) => (
            <div key={s.k}>
              <div className="display" style={{ fontSize: "clamp(28px, 4.6vw, 42px)", overflowWrap: "anywhere" }}>{s.v}</div>
              <div className="serif italic" style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 6 }}>{s.k}</div>
            </div>
          ))}
        </div>
      </section>

      {/* drop */}
      <section id="drop" style={{ ...wrap, marginTop: 40 }}>
        <div className="panel" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
            <h2 className="serif" style={{ fontSize: 26, fontWeight: 800 }}>Drop a sketch</h2>
            {account ? (
              <span className="num" style={{ fontSize: 12.5, color: "var(--muted)" }}>You&apos;ve earned ${fmtUsdc(earned)} on InkFuse</span>
            ) : (
              <button onClick={connect} className="btn btn--sm">Connect to drop</button>
            )}
          </div>
          <div className="form-row" style={{ marginBottom: 12 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                <span className="serif italic" style={{ fontSize: 13.5, color: "var(--muted)" }}>Image</span>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={!account || uploading}
                  style={{ background: "none", border: "none", padding: 0, cursor: account && !uploading ? "pointer" : "not-allowed", color: uploading ? "var(--muted)" : "var(--red)", fontFamily: "'Manrope', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", opacity: account ? 1 : 0.45 }}
                >
                  {uploading ? "Uploading…" : "↑ Upload from computer"}
                </button>
                <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} style={{ display: "none" }} />
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <input value={uri} onChange={(e) => setUri(e.target.value)} maxLength={400} className="input" placeholder="https://…  or upload ↑" disabled={!account} />
                {looksLikeUrl(uri) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={uri} alt="" onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} style={{ width: 42, height: 42, objectFit: "cover", borderRadius: 3, border: "1px solid var(--line-2)", flexShrink: 0 }} />
                )}
              </div>
            </div>
            <Field label="Title">
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className="input" placeholder="Untitled no. 7" disabled={!account} />
            </Field>
          </div>
          <div className="form-row-3" style={{ marginBottom: 16 }}>
            <Field label="Price / edition (USDC)">
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="input" placeholder="1" disabled={!account} />
            </Field>
            <Field label="Editions (0 = open)">
              <input value={cap} onChange={(e) => setCap(e.target.value)} inputMode="numeric" className="input" placeholder="open" disabled={!account} />
            </Field>
            <Field label="Resale royalty %">
              <input value={roy} onChange={(e) => setRoy(e.target.value)} inputMode="decimal" className="input" placeholder="10" disabled={!account} />
            </Field>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <button onClick={dropSketch} disabled={activeKey !== null || !account} className="btn btn--red btn--lg">{activeKey === "drop" ? "Working…" : account ? "Drop it on-chain" : "Connect wallet"}</button>
            {dropMsg && (
              <span className="num" style={{ fontSize: 13, color: dropMsg.startsWith("✓") ? "var(--red-2)" : dropMsg.startsWith("✗") ? "#ff5a4d" : "var(--muted)" }}>{dropMsg}</span>
            )}
          </div>
        </div>
      </section>

      {/* tabs + grid */}
      <section id="gallery" style={{ ...wrap, marginTop: 44 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
          <h2 className="serif" style={{ fontSize: 28, fontWeight: 800 }}>
            {tab === "gallery" ? "The gallery" : tab === "market" ? "The market" : "Your wall"}
          </h2>
          <div className="tabs">
            {([["gallery", `Gallery ${sketches.length || ""}`], ["market", `Market ${listings.length || ""}`], ["mine", "Yours"]] as const).map(([t, lbl]) => (
              <button key={t} data-on={tab === t} onClick={() => setTab(t)}>{lbl}</button>
            ))}
          </div>
        </div>

        {tab === "gallery" && (
          sketches.length === 0 ? (
            <Empty>No sketches yet. Be the first to drop one ↑</Empty>
          ) : (
            <div className="gallery">
              {sketches.map((s) => (
                <SketchCard key={s.id} sketch={s} me={account} busy={activeKey === "s" + s.id} msg={note["s" + s.id]} onCollect={collect} onTip={tip} />
              ))}
            </div>
          )
        )}

        {tab === "market" && (
          listings.length === 0 ? (
            <Empty>Nothing listed for resale right now.</Empty>
          ) : (
            <div className="gallery">
              {listings.map((p) => (
                <PieceCard key={p.e.id} piece={p} me={account} mode="market" busy={activeKey === "e" + p.e.id} msg={note["e" + p.e.id]} onBuy={buy} onList={listEd} onDelist={delistEd} />
              ))}
            </div>
          )
        )}

        {tab === "mine" && (
          !account ? (
            <Empty>Connect your wallet to see your wall.</Empty>
          ) : mineCount === 0 ? (
            <Empty>Nothing here yet — collect a piece or drop your own.</Empty>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
              {collection.length > 0 && (
                <div>
                  <div className="label" style={{ marginBottom: 14 }}>Collected editions</div>
                  <div className="gallery">
                    {collection.map((p) => (
                      <PieceCard key={p.e.id} piece={p} me={account} mode="mine" busy={activeKey === "e" + p.e.id} msg={note["e" + p.e.id]} onBuy={buy} onList={listEd} onDelist={delistEd} />
                    ))}
                  </div>
                </div>
              )}
              {myDrops.length > 0 && (
                <div>
                  <div className="label" style={{ marginBottom: 14 }}>Your drops</div>
                  <div className="gallery">
                    {myDrops.map((s) => (
                      <SketchCard key={s.id} sketch={s} me={account} busy={activeKey === "s" + s.id} msg={note["s" + s.id]} onCollect={collect} onTip={tip} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </section>

      {/* why arc — manifesto */}
      <section style={{ ...wrap, marginTop: "clamp(60px, 9vw, 104px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 26 }}>
          <span style={{ width: 40, height: 1, background: "var(--red)" }} />
          <span className="serif italic" style={{ fontSize: 14.5, color: "var(--bone-dim)" }}>Why it lives on Arc</span>
        </div>
        <p className="serif" style={{ fontSize: "clamp(23px, 3.4vw, 40px)", fontWeight: 500, lineHeight: 1.32, maxWidth: 1000, letterSpacing: "-0.005em" }}>
          A few cents clears because Arc settles in <span style={{ color: "var(--red)" }}>native USDC</span> — no
          token, no gas dance, no approval. Collect, resell or tip and the money lands the{" "}
          <span className="italic" style={{ color: "var(--red)" }}>same second</span>. A resale{" "}
          <span className="italic" style={{ color: "var(--red)" }}>splits itself</span> — the royalty home, the
          rest to the seller — in one transaction. And every listing is an open{" "}
          <span className="italic">buy()</span>, so an agent can sweep the market with no middleman in the way.
        </p>
      </section>

      {/* footer */}
      <footer style={{ ...wrap, marginTop: "clamp(52px, 7vw, 80px)" }}>
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 24, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <span className="serif" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>
            Ink<span className="italic" style={{ color: "var(--red)" }}>Fuse</span>
          </span>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            {hasContract() && (
              <a href={`${ARCSCAN}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noopener noreferrer" className="num" style={{ fontSize: 12, color: "var(--muted)", textDecoration: "none" }}>
                {shortAddr(CONTRACT_ADDRESS, 10, 8)} ↗
              </a>
            )}
            <span className="serif italic" style={{ fontSize: 12.5, color: "var(--faint)" }}>ink, settled on Arc</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="serif italic" style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="panel" style={{ padding: 48, textAlign: "center" }}>
      <span className="num" style={{ color: "var(--muted)", fontSize: 13.5 }}>{children}</span>
    </div>
  );
}
