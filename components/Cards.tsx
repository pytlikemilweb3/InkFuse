"use client";

import { useState } from "react";
import { Sketch, Piece, fmtUsdc, shortAddr, royaltyPct, timeAgo } from "@/lib/inkfuse";
import { ARCSCAN } from "@/lib/arcNetwork";

function Art({ uri, href }: { uri: string; href?: string }) {
  return (
    <a className="frame-art" href={href || uri} target="_blank" rel="noopener noreferrer">
      {/* placeholder underneath — shown if the image is missing or 404s */}
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="40" height="40" viewBox="0 0 32 32" fill="none">
          <path d="M16 7c4.2 5 5.6 8 5.6 11a5.6 5.6 0 1 1-11.2 0c0-3 1.4-6 5.6-11z" fill="var(--line-2)" />
        </svg>
      </span>
      {uri && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={uri}
          alt=""
          loading="lazy"
          onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      )}
    </a>
  );
}

function Msg({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <div className="num" style={{ fontSize: 11.5, fontWeight: 700, marginTop: 4, color: msg.startsWith("✓") ? "var(--red-2)" : msg.startsWith("✗") ? "#ff5a4d" : "var(--muted)" }}>
      {msg}
    </div>
  );
}

const placard: React.CSSProperties = { padding: "13px 14px", display: "flex", flexDirection: "column", gap: 9, flex: 1 };

// ── gallery card ──────────────────────────────────────────────
export function SketchCard({
  sketch,
  me,
  busy,
  msg,
  onCollect,
  onTip,
}: {
  sketch: Sketch;
  me: string;
  busy: boolean;
  msg?: string;
  onCollect: (id: number, price: bigint) => void;
  onTip: (id: number) => void;
}) {
  const mine = me && sketch.artist.toLowerCase() === me.toLowerCase();
  const soldOut = sketch.cap > 0 && sketch.minted >= sketch.cap;
  const free = sketch.price === 0n;

  return (
    <div className="frame">
      <div style={{ position: "relative" }}>
        <Art uri={sketch.uri} />
        <span className="chip" style={{ position: "absolute", top: 10, left: 10, background: "rgba(11,10,12,0.7)", backdropFilter: "blur(4px)", fontSize: 10.5 }}>
          {sketch.cap === 0 ? `${sketch.minted} open` : `${sketch.minted}/${sketch.cap}`}
        </span>
      </div>
      <div style={placard}>
        <div style={{ flex: 1 }}>
          <div className="serif" style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.15 }}>{sketch.title}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <a href={`${ARCSCAN}/address/${sketch.artist}`} target="_blank" rel="noopener noreferrer" className="num" style={{ fontSize: 11.5, color: "var(--muted)", textDecoration: "none" }}>
              {mine ? "by you" : `by ${shortAddr(sketch.artist)}`}
            </a>
            <span style={{ color: "var(--faint)", fontSize: 11 }}>· {timeAgo(sketch.createdAt)}</span>
          </div>
        </div>

        <div className="num" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, flexWrap: "wrap", fontSize: 12.5, fontWeight: 700, borderTop: "1px solid var(--line)", paddingTop: 9 }}>
          <span style={{ overflowWrap: "anywhere" }}>{free ? "FREE" : "$" + fmtUsdc(sketch.price)}</span>
          <span style={{ color: "var(--muted)", fontWeight: 600 }}>{royaltyPct(sketch.royaltyBps)} royalty</span>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {mine ? (
            <div className="chip" style={{ flex: 1, justifyContent: "center", padding: "9px 0" }}>Your drop</div>
          ) : (
            <button onClick={() => onCollect(sketch.id, sketch.price)} disabled={busy || soldOut} className="btn btn--red btn--sm" style={{ flex: 1 }}>
              {busy ? "…" : soldOut ? "Sold out" : free ? "Collect · free" : `Collect · $${fmtUsdc(sketch.price)}`}
            </button>
          )}
          <button onClick={() => onTip(sketch.id)} disabled={busy} className="btn btn--sm" title="Tip the artist" style={{ flexShrink: 0 }}>
            Tip
          </button>
        </div>
        <Msg msg={msg} />
      </div>
    </div>
  );
}

// ── market / collection card ──────────────────────────────────
export function PieceCard({
  piece,
  me,
  mode,
  busy,
  msg,
  onBuy,
  onList,
  onDelist,
}: {
  piece: Piece;
  me: string;
  mode: "market" | "mine";
  busy: boolean;
  msg?: string;
  onBuy: (editionId: number, price: bigint) => void;
  onList: (editionId: number, price: string) => void;
  onDelist: (editionId: number) => void;
}) {
  const { e, s } = piece;
  const [price, setPrice] = useState("");
  const listed = e.listPrice > 0n;
  const mineEd = me && e.owner.toLowerCase() === me.toLowerCase();
  const royaltyOnList = (e.listPrice * BigInt(s.royaltyBps)) / 10000n;

  return (
    <div className="frame">
      <div style={{ position: "relative" }}>
        <Art uri={s.uri} />
        <span className="chip" style={{ position: "absolute", top: 10, left: 10, background: "rgba(11,10,12,0.7)", backdropFilter: "blur(4px)", fontSize: 10.5 }}>
          edition #{e.number}
        </span>
        {listed && (
          <span className="chip chip--red" style={{ position: "absolute", top: 10, right: 10, background: "rgba(11,10,12,0.7)", backdropFilter: "blur(4px)", fontSize: 10.5 }}>
            for sale
          </span>
        )}
      </div>
      <div style={placard}>
        <div style={{ flex: 1 }}>
          <div className="serif" style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.15 }}>{s.title}</div>
          <a href={`${ARCSCAN}/address/${s.artist}`} target="_blank" rel="noopener noreferrer" className="num" style={{ fontSize: 11.5, color: "var(--muted)", textDecoration: "none" }}>
            by {shortAddr(s.artist)}
          </a>
        </div>

        {mode === "market" ? (
          <>
            <div className="num" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, flexWrap: "wrap", fontSize: 12.5, fontWeight: 700, borderTop: "1px solid var(--line)", paddingTop: 9 }}>
              <span style={{ overflowWrap: "anywhere" }}>${fmtUsdc(e.listPrice)}</span>
              <span style={{ color: "var(--muted)", fontWeight: 600, overflowWrap: "anywhere" }}>${fmtUsdc(royaltyOnList)} to artist</span>
            </div>
            {mineEd ? (
              <button onClick={() => onDelist(e.id)} disabled={busy} className="btn btn--sm btn--block">{busy ? "…" : "Delist"}</button>
            ) : (
              <button onClick={() => onBuy(e.id, e.listPrice)} disabled={busy} className="btn btn--red btn--sm btn--block">
                {busy ? "…" : `Buy · $${fmtUsdc(e.listPrice)}`}
              </button>
            )}
          </>
        ) : (
          <>
            <div className="num" style={{ fontSize: 11.5, color: "var(--muted)", borderTop: "1px solid var(--line)", paddingTop: 9 }}>
              {listed ? `Listed · $${fmtUsdc(e.listPrice)}` : `${royaltyPct(s.royaltyBps)} resale royalty`}
            </div>
            {listed ? (
              <button onClick={() => onDelist(e.id)} disabled={busy} className="btn btn--sm btn--block">{busy ? "…" : "Delist"}</button>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <input value={price} onChange={(ev) => setPrice(ev.target.value)} inputMode="decimal" className="input" placeholder="price" style={{ padding: "9px 11px", fontSize: 13 }} />
                <button onClick={() => onList(e.id, price)} disabled={busy} className="btn btn--red btn--sm" style={{ flexShrink: 0 }}>{busy ? "…" : "List"}</button>
              </div>
            )}
          </>
        )}
        <Msg msg={msg} />
      </div>
    </div>
  );
}
