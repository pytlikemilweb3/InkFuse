export const runtime = "nodejs";

/**
 * Tiny upload relay: takes an image from the browser and hands it to a public
 * image host server-side (no key, no CORS), returning a permanent direct URL
 * that's short enough to store on-chain as the sketch's image.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
    if (!file.type.startsWith("image/")) return Response.json({ error: "Images only" }, { status: 415 });
    if (file.size > 4 * 1024 * 1024) return Response.json({ error: "Max 4 MB" }, { status: 413 });

    const out = new FormData();
    out.append("reqtype", "fileupload");
    out.append("fileToUpload", file, file.name || "sketch.png");

    const res = await fetch("https://catbox.moe/user/api.php", { method: "POST", body: out });
    const text = (await res.text()).trim();
    if (!res.ok || !/^https?:\/\/\S+$/.test(text)) {
      return Response.json({ error: "Host rejected the upload" }, { status: 502 });
    }
    return Response.json({ url: text });
  } catch {
    return Response.json({ error: "Upload failed" }, { status: 500 });
  }
}
