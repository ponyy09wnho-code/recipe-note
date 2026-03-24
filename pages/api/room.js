export const config = {
  api: { bodyParser: { sizeLimit: "5mb" } }
};

function generateCode(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({length:6},()=>chars[Math.floor(Math.random()*chars.length)]).join("");
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

async function sbFetch(path, options = {}) {
  const res = await fetch(SUPABASE_URL + "/rest/v1" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": "Bearer " + SUPABASE_KEY,
      "Prefer": "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.message || "Supabaseエラー: " + res.status);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function getRoom(code) {
  const data = await sbFetch("/rooms?code=eq." + code + "&limit=1");
  return data?.[0] || null;
}

async function upsertRoom(room) {
  return await sbFetch("/rooms?code=eq." + room.code, {
    method: "PATCH",
    body: JSON.stringify({
      recipes: room.recipes,
      members: room.members,
      updated_at: new Date().toISOString(),
    }),
  });
}

export default async function handler(req, res) {
  const { method } = req;

  if (method === "PUT") {
    const { member } = req.body;
    let code, existing;
    do {
      code = generateCode();
      existing = await getRoom(code).catch(() => null);
    } while (existing);

    await sbFetch("/rooms", {
      method: "POST",
      body: JSON.stringify({
        code,
        recipes: [],
        members: [member],
      }),
    });

    return res.status(200).json({ code });
  }

  if (method === "GET") {
    const { code, member } = req.query;
    if (!code) return res.status(400).json({ error: "コードが必要です" });

    const room = await getRoom(code).catch(() => null);
    if (!room) return res.status(404).json({ error: "ルームが見つかりません" });

    if (member && !room.members.includes(member)) {
      room.members = [...room.members, member];
      await upsertRoom(room);
    }

    return res.status(200).json({
      code: room.code,
      recipes: room.recipes || [],
      members: room.members || [],
    });
  }

  if (method === "POST") {
    const { code, recipes, member } = req.body;
    if (!code) return res.status(400).json({ error: "コードが必要です" });

    const room = await getRoom(code).catch(() => null);
    if (!room) return res.status(404).json({ error: "ルームが見つかりません" });

    const map = new Map();
    (room.recipes || []).forEach(r => map.set(r.id, r));
    (recipes || []).forEach(r => {
      const ex = map.get(r.id);
      if (!ex) {
        map.set(r.id, r);
      } else {
        const lu = ex.updatedAt || ex.addedAt || "";
        const ru = r.updatedAt || r.addedAt || "";
        if (ru >= lu) map.set(r.id, r);
      }
    });

    const merged = Array.from(map.values());
    const members = room.members.includes(member)
      ? room.members
      : [...room.members, member];

    await upsertRoom({ code, recipes: merged, members });

    return res.status(200).json({ recipes: merged, members });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
