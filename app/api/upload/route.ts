import { put } from "@vercel/blob";

export const runtime = "nodejs";

/**
 * Upload relay: takes an image from the browser and returns a permanent direct
 * URL short enough to store on-chain. Primary store is Vercel Blob (first-party,
 * permanent); keyless public hosts are kept as fallbacks for local/dev where the
 * Blob token isn't present.
 */

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function viaBlob(file: File): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const ext = (file.name?.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "png";
  const blob = await put(`sketches/ink.${ext}`, file, { access: "public", addRandomSuffix: true, contentType: file.type });
  return blob.url;
}

async function viaCatbox(file: File): Promise<string | null> {
  const fd = new FormData();
  fd.append("reqtype", "fileupload");
  fd.append("fileToUpload", file, file.name || "sketch.png");
  const r = await fetch("https://catbox.moe/user/api.php", { method: "POST", body: fd, headers: { "User-Agent": UA } });
  const t = (await r.text()).trim();
  return r.ok && /^https?:\/\/\S+\.\S+\/\S+$/.test(t) ? t : null;
}

async function viaTmpfiles(file: File): Promise<string | null> {
  const fd = new FormData();
  fd.append("file", file, file.name || "sketch.png");
  const r = await fetch("https://tmpfiles.org/api/v1/upload", { method: "POST", body: fd, headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const j = (await r.json().catch(() => null)) as { data?: { url?: string } } | null;
  const u = j?.data?.url;
  if (!u || !/^https?:\/\//.test(u)) return null;
  return u.replace("tmpfiles.org/", "tmpfiles.org/dl/");
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
    if (!file.type.startsWith("image/")) return Response.json({ error: "Images only" }, { status: 415 });
    if (file.size > 4 * 1024 * 1024) return Response.json({ error: "Max 4 MB" }, { status: 413 });

    for (const provider of [viaBlob, viaCatbox, viaTmpfiles]) {
      try {
        const url = await provider(file);
        if (url) return Response.json({ url });
      } catch {
        /* try the next host */
      }
    }
    return Response.json({ error: "Image hosts unavailable — paste a URL instead" }, { status: 502 });
  } catch {
    return Response.json({ error: "Upload failed" }, { status: 500 });
  }
}
