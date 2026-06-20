// ---------------------------------------------------------------------------
// EIP-6963 multi-wallet discovery
//
// With more than one extension installed (Rabby, MetaMask, OKX, Phantom, …)
// they all clobber window.ethereum and requests vanish into the wrong one.
// EIP-6963 has every wallet announce itself, so we can lock onto a single
// provider (Rabby by preference) and route reads, writes and event listeners
// through that exact instance instead of the ambiguous window.ethereum.
// ---------------------------------------------------------------------------

// localStorage slot that remembers which wallet rdns the user pinned.
const STORE_NS = "ink";
const PINNED_WALLET_SLOT = `${STORE_NS}:6963:pinned-rdns`;

// Preference order applied when the user has not pinned anything yet.
const PREFERENCE = ["io.rabby", "io.metamask"];

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  isRabby?: boolean;
  isMetaMask?: boolean;
}

interface ProviderDetail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

// Every wallet that has announced itself so far this session.
const discovered: ProviderDetail[] = [];

function record(detail?: ProviderDetail) {
  if (!detail?.info?.rdns || !detail.provider) return;
  const i = discovered.findIndex((d) => d.info.rdns === detail.info.rdns);
  if (i === -1) discovered.push(detail);
  else discovered[i] = detail;
}

// Begin listening for announcements as soon as this module loads.
if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (e: Event) => {
    record((e as CustomEvent<ProviderDetail>).detail);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function setChosenRdns(rdns: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PINNED_WALLET_SLOT, rdns);
  } catch {
    /* ignore */
  }
}

export function getChosenRdns(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(PINNED_WALLET_SLOT) || "";
  } catch {
    return "";
  }
}

export function refreshWallets() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function ensureDiscovered(timeoutMs = 250): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (discovered.length) {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve();
    };
    const onAnnounce = () => finish();
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(finish, timeoutMs);
  });
}

export function listWallets() {
  refreshWallets();
  return discovered.map((d) => ({ name: d.info.name, rdns: d.info.rdns, icon: d.info.icon }));
}

export function pickDetail(rdns?: string): { provider: Eip1193Provider; rdns: string } | undefined {
  refreshWallets();
  // 1) honour an explicit request or the pinned choice
  const want = rdns ?? getChosenRdns();
  if (want) {
    const m = discovered.find((d) => d.info.rdns === want);
    if (m) return { provider: m.provider, rdns: m.info.rdns };
  }
  // 2) fall back through the preference list
  for (const r of PREFERENCE) {
    const m = discovered.find((d) => d.info.rdns === r);
    if (m) return { provider: m.provider, rdns: m.info.rdns };
  }
  // 3) otherwise just take whatever announced first
  if (discovered[0]) return { provider: discovered[0].provider, rdns: discovered[0].info.rdns };
  return undefined;
}

export function pickProvider(rdns?: string): Eip1193Provider | undefined {
  const d = pickDetail(rdns);
  if (d) return d.provider;
  // last resort: the raw injected provider, if any
  return typeof window !== "undefined" ? (window.ethereum as Eip1193Provider | undefined) : undefined;
}
