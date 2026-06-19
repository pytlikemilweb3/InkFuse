import { ethers } from "ethers";
import { ARC_RPC } from "./arcNetwork";

// ─────────────────────────────────────────────────────────────
// InkFuse — drop a sketch, collect it, resell with royalties, tip the artist.
// One deployed contract, the single source of truth.
// ─────────────────────────────────────────────────────────────
export const CONTRACT_ADDRESS = "0x69e7dc5CA22a76538Ba059F175E939336b5E4b24";

export const INKFUSE_ABI = [
  "function drop(string uri, string title, uint256 price, uint32 cap, uint16 royaltyBps) returns (uint256)",
  "function collect(uint256 sketchId) payable returns (uint256)",
  "function list(uint256 editionId, uint256 price)",
  "function delist(uint256 editionId)",
  "function buy(uint256 editionId) payable",
  "function tip(uint256 sketchId) payable",
  "function sketchCount() view returns (uint256)",
  "function editionCount() view returns (uint256)",
  "function listedCount() view returns (uint256)",
  "function primaryVolume() view returns (uint256)",
  "function secondaryVolume() view returns (uint256)",
  "function royaltiesPaid() view returns (uint256)",
  "function tipsPaid() view returns (uint256)",
  "function artistEarned(address) view returns (uint256)",
  "function getSketch(uint256) view returns (tuple(uint256 id, address artist, string uri, string title, uint256 price, uint32 cap, uint32 minted, uint16 royaltyBps, uint64 createdAt))",
  "function getEdition(uint256) view returns (tuple(uint256 id, uint256 sketchId, uint32 number, address owner, uint256 listPrice))",
  "function sketchesOf(address) view returns (uint256[])",
  "function ownedEditions(address) view returns (uint256[])",
  "function listedEditions() view returns (uint256[])",
  "event Dropped(uint256 indexed sketchId, address indexed artist, string uri, string title, uint256 price, uint32 cap, uint16 royaltyBps)",
  "event Collected(uint256 indexed sketchId, uint256 indexed editionId, address indexed collector, uint32 number, uint256 price)",
  "event Listed(uint256 indexed editionId, address indexed owner, uint256 price)",
  "event Delisted(uint256 indexed editionId, address indexed owner)",
  "event Sold(uint256 indexed editionId, address indexed from, address indexed to, uint256 price, uint256 royalty)",
  "event Tipped(uint256 indexed sketchId, address indexed from, address indexed artist, uint256 amount)",
];

export interface Sketch {
  id: number;
  artist: string;
  uri: string;
  title: string;
  price: bigint;
  cap: number;
  minted: number;
  royaltyBps: number;
  createdAt: number;
}

export interface Edition {
  id: number;
  sketchId: number;
  number: number;
  owner: string;
  listPrice: bigint;
}

export interface Global {
  sketches: number;
  editions: number;
  listed: number;
  primary: bigint;
  secondary: bigint;
  royalties: bigint;
  tips: bigint;
}

/** An edition joined with its sketch — for the market & collection views. */
export interface Piece {
  e: Edition;
  s: Sketch;
}

export const EMPTY_GLOBAL: Global = { sketches: 0, editions: 0, listed: 0, primary: 0n, secondary: 0n, royalties: 0n, tips: 0n };

// ── connection ───────────────────────────────────────────────
export function readProvider() {
  return new ethers.JsonRpcProvider(ARC_RPC);
}
export function readContract(provider?: ethers.Provider) {
  return new ethers.Contract(CONTRACT_ADDRESS, INKFUSE_ABI, provider ?? readProvider());
}
export function hasContract(): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(CONTRACT_ADDRESS);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  const failed: T[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const settled = await Promise.allSettled(batch.map(fn));
    settled.forEach((s, j) => (s.status === "fulfilled" ? out.push(s.value) : failed.push(batch[j])));
  }
  const stillFailed: T[] = [];
  for (let i = 0; i < failed.length; i += limit) {
    const batch = failed.slice(i, i + limit);
    const settled = await Promise.allSettled(batch.map(fn));
    settled.forEach((s, j) => (s.status === "fulfilled" ? out.push(s.value) : stillFailed.push(batch[j])));
  }
  if (stillFailed.length) console.warn(`inkfuse: ${stillFailed.length} read(s) failed after retry`);
  return out;
}

// ── shapers ──────────────────────────────────────────────────
type RawSketch = { id: bigint; artist: string; uri: string; title: string; price: bigint; cap: bigint; minted: bigint; royaltyBps: bigint; createdAt: bigint };
function toSketch(s: RawSketch): Sketch {
  return {
    id: Number(s.id),
    artist: s.artist,
    uri: s.uri,
    title: s.title,
    price: s.price,
    cap: Number(s.cap),
    minted: Number(s.minted),
    royaltyBps: Number(s.royaltyBps),
    createdAt: Number(s.createdAt),
  };
}

type RawEdition = { id: bigint; sketchId: bigint; number: bigint; owner: string; listPrice: bigint };
function toEdition(e: RawEdition): Edition {
  return { id: Number(e.id), sketchId: Number(e.sketchId), number: Number(e.number), owner: e.owner, listPrice: e.listPrice };
}

// ── reads ────────────────────────────────────────────────────
export const MAX = 60;

export async function fetchGlobal(contract?: ethers.Contract): Promise<Global> {
  const c = contract ?? readContract();
  const [sketches, editions, listed, primary, secondary, royalties, tips] = await Promise.all([
    c.sketchCount(),
    c.editionCount(),
    c.listedCount(),
    c.primaryVolume(),
    c.secondaryVolume(),
    c.royaltiesPaid(),
    c.tipsPaid(),
  ]);
  return {
    sketches: Number(sketches),
    editions: Number(editions),
    listed: Number(listed),
    primary,
    secondary,
    royalties,
    tips,
  };
}

/** Latest sketches (newest first), windowed to MAX. */
export async function fetchSketches(contract?: ethers.Contract): Promise<Sketch[]> {
  const c = contract ?? readContract();
  const count = Number(await c.sketchCount());
  if (!count) return [];
  const start = Math.max(1, count - MAX + 1);
  const ids: number[] = [];
  for (let i = count; i >= start; i--) ids.push(i);
  const raw = await mapLimit(ids, 8, async (id) => toSketch(await c.getSketch(id)));
  raw.sort((a, b) => b.id - a.id);
  return raw;
}

export async function fetchSketchesOf(addr: string, contract?: ethers.Contract): Promise<Sketch[]> {
  const c = contract ?? readContract();
  const ids: bigint[] = await c.sketchesOf(addr);
  const raw = await mapLimit(ids.slice(-MAX).map(Number), 8, async (id) => toSketch(await c.getSketch(id)));
  raw.sort((a, b) => b.id - a.id);
  return raw;
}

export async function fetchSketch(id: number, contract?: ethers.Contract): Promise<Sketch | null> {
  const c = contract ?? readContract();
  try {
    const s = toSketch(await c.getSketch(id));
    return s.artist === ethers.ZeroAddress ? null : s;
  } catch {
    return null;
  }
}

/** Active market listings (joined with their sketch), newest edition first. */
export async function fetchListings(contract?: ethers.Contract): Promise<Piece[]> {
  const c = contract ?? readContract();
  const ids: bigint[] = await c.listedEditions();
  const uniq = Array.from(new Set(ids.map(Number))).slice(-MAX);
  const eds = await mapLimit(uniq, 8, async (id) => toEdition(await c.getEdition(id)));
  const active = eds.filter((e) => e.listPrice > 0n);
  const sketchIds = Array.from(new Set(active.map((e) => e.sketchId)));
  const sketchList = await mapLimit(sketchIds, 8, async (id) => toSketch(await c.getSketch(id)));
  const byId: Record<number, Sketch> = {};
  sketchList.forEach((s) => (byId[s.id] = s));
  return active
    .filter((e) => byId[e.sketchId])
    .map((e) => ({ e, s: byId[e.sketchId] }))
    .sort((a, b) => b.e.id - a.e.id);
}

/** Editions currently owned by `addr` (joined with their sketch), newest first. */
export async function fetchCollection(addr: string, contract?: ethers.Contract): Promise<Piece[]> {
  const c = contract ?? readContract();
  const ids: bigint[] = await c.ownedEditions(addr);
  const uniq = Array.from(new Set(ids.map(Number))).slice(-MAX);
  const eds = await mapLimit(uniq, 8, async (id) => toEdition(await c.getEdition(id)));
  const mine = eds.filter((e) => e.owner.toLowerCase() === addr.toLowerCase());
  const sketchIds = Array.from(new Set(mine.map((e) => e.sketchId)));
  const sketchList = await mapLimit(sketchIds, 8, async (id) => toSketch(await c.getSketch(id)));
  const byId: Record<number, Sketch> = {};
  sketchList.forEach((s) => (byId[s.id] = s));
  return mine
    .filter((e) => byId[e.sketchId])
    .map((e) => ({ e, s: byId[e.sketchId] }))
    .sort((a, b) => b.e.id - a.e.id);
}

export async function fetchArtistEarned(addr: string, contract?: ethers.Contract): Promise<bigint> {
  const c = contract ?? readContract();
  return await c.artistEarned(addr);
}

// ── formatting ───────────────────────────────────────────────
export function shortAddr(addr: string, lead = 6, tail = 4): string {
  if (!addr) return "";
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}

export function fmtUsdc(wei: bigint, dp = 2): string {
  const n = parseFloat(ethers.formatEther(wei));
  if (n === 0) return "0";
  if (n < 0.0001) return "<0.0001";
  if (n < 0.01) {
    const s = n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    return s === "0" ? "<0.0001" : s;
  }
  const s = n.toFixed(dp);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

export function royaltyPct(bps: number): string {
  const p = bps / 100;
  return (Number.isInteger(p) ? p.toString() : p.toFixed(1)) + "%";
}

export function timeAgo(unixSeconds: number): string {
  if (!unixSeconds) return "";
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 0) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/** Best-effort image URL check for the drop form — https only, to avoid mixed-content failures. */
export function looksLikeUrl(u: string): boolean {
  return /^https:\/\/.{3,}/.test(u.trim());
}
