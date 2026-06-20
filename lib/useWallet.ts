"use client";

import { ethers } from "ethers";
import { useCallback, useEffect, useRef, useState } from "react";
import { ensureDiscovered, pickDetail, pickProvider, setChosenRdns, type Eip1193Provider } from "./wallet";
import { ARC_CHAIN_HEX, ARC_RPC, switchToArc } from "./arcNetwork";

// Persisted flag: once the user explicitly disconnects we stay disconnected
// across reloads until they connect again. Built from a small prefix so it
// reads distinctly from the wallet-pinning slot in ./wallet.
const PERSIST_PREFIX = "ink.session";
const STAY_DISCONNECTED = `${PERSIST_PREFIX}.optout`;

const isHex = (value: unknown, target: string) =>
  typeof value === "string" && value.toLowerCase() === target.toLowerCase();

/**
 * Single source of truth for wallet state. Discovers wallets via EIP-6963
 * (Rabby first), pins the chosen one, and binds account/chain listeners to the
 * exact provider in use. Supports an explicit disconnect that survives reloads.
 */
export function useWallet() {
  const [account, setAccount] = useState("");
  const [balance, setBalance] = useState("");
  const [chainOk, setChainOk] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const optedOutRef = useRef(false);
  const subRef = useRef<{ provider: Eip1193Provider; cleanup: () => void } | null>(null);

  const refreshBalance = useCallback(async (addr: string) => {
    try {
      const rpc = new ethers.JsonRpcProvider(ARC_RPC);
      const wei = await rpc.getBalance(addr);
      setBalance(parseFloat(ethers.formatEther(wei)).toFixed(3));
    } catch {
      setBalance("—");
    }
  }, []);

  const subscribe = useCallback(
    (inj: Eip1193Provider) => {
      if (!inj?.on) return;
      // already bound to this exact provider — nothing to do
      if (subRef.current?.provider === inj) return;
      subRef.current?.cleanup();

      const handleAccounts = (a: unknown) => {
        if (optedOutRef.current) return;
        const list = a as string[];
        if (list.length) {
          setAccount(list[0]);
          refreshBalance(list[0]);
        } else {
          setAccount("");
          setBalance("");
          setChainOk(false);
        }
      };
      const handleChain = (c: unknown) => setChainOk(isHex(c, ARC_CHAIN_HEX));

      inj.on("accountsChanged", handleAccounts);
      inj.on("chainChanged", handleChain);
      subRef.current = {
        provider: inj,
        cleanup: () => {
          inj.removeListener?.("accountsChanged", handleAccounts);
          inj.removeListener?.("chainChanged", handleChain);
        },
      };
    },
    [refreshBalance]
  );

  const connect = useCallback(async () => {
    optedOutRef.current = false;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(STAY_DISCONNECTED);
      } catch {
        /* ignore */
      }
    }
    await ensureDiscovered();
    const detail = pickDetail();
    const inj = detail?.provider;
    if (!inj) return;
    setChosenRdns(detail.rdns);
    setConnecting(true);
    try {
      const accs = (await inj.request({ method: "eth_requestAccounts" })) as string[];
      if (!accs?.length) return;
      setAccount(accs[0]);
      subscribe(inj);
      try {
        await switchToArc(inj);
      } catch {
        /* user declined the network switch — still finish connecting */
      }
      try {
        const id = (await inj.request({ method: "eth_chainId" })) as string;
        setChainOk(isHex(id, ARC_CHAIN_HEX));
      } catch {
        setChainOk(false);
      }
      refreshBalance(accs[0]);
    } catch {
      /* user rejected the connection */
    } finally {
      setConnecting(false);
    }
  }, [refreshBalance, subscribe]);

  const disconnect = useCallback(() => {
    optedOutRef.current = true;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STAY_DISCONNECTED, "1");
      } catch {
        /* ignore */
      }
    }
    setAccount("");
    setBalance("");
    setChainOk(false);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage.getItem(STAY_DISCONNECTED) === "1") {
      optedOutRef.current = true;
    }
    (async () => {
      await ensureDiscovered();
      const inj = pickProvider();
      if (!inj) return;
      if (!optedOutRef.current) {
        try {
          const accs = (await inj.request({ method: "eth_accounts" })) as string[];
          if (accs.length) {
            setAccount(accs[0]);
            refreshBalance(accs[0]);
            inj
              .request({ method: "eth_chainId" })
              .then((id) => setChainOk(isHex(id, ARC_CHAIN_HEX)))
              .catch(() => {});
          }
        } catch {
          /* ignore */
        }
      }
      subscribe(inj);
    })();
    return () => {
      subRef.current?.cleanup();
      subRef.current = null;
    };
  }, [refreshBalance, subscribe]);

  return { account, balance, chainOk, connecting, connect, disconnect, refreshBalance };
}
