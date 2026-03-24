export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } }
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const BUCKET = "recipe-images";

export default async function handler(req, res) {
  if (req.method === "POST") {
    const { base64, mediaType, path } = req.body;
    if (!base64 || !path) return res.status(400).json({ error: "base64とpathが必要です" });
    try {
      const binary = Buffer.from(base64, "base64");
      const uploadRes = await fetch(
        SUPABASE_URL + "/storage/v1/object/" + BUCKET + "/" + path,
        {
          method: "POST",
          headers: {
            "Content-Type": mediaType || "image/jpeg",
            "apikey": SUPABASE_KEY,
            "Authorization": "Bearer " + SUPABASE_KEY,
          },
          body: binary,
        }
      );
      if (!uploadRes.ok) {
        const e = await uploadRes.json().catch(() => ({}));
        throw new Error(e?.message || "アップロード失敗: " + uploadRes.status);
      }
      const publicUrl = SUPABASE_URL + "/storage/v1/object/public/" + BUCKET + "/" + path;
      return res.status(200).json({ url: publicUrl });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "DELETE") {
    const { paths } = req.body;
    if (!paths || !paths.length) return res.status(400).json({ error: "pathsが必要です" });
    try {
      await fetch(SUPABASE_URL + "/storage/v1/object/" + BUCKET, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_KEY,
          "Authorization": "Bearer " + SUPABASE_KEY,
        },
        body: JSON.stringify({ prefixes: paths }),
      });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
