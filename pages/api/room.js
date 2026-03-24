export const config = {
  api: { bodyParser: { sizeLimit: "5mb" } }
};

const FIXED_CODE = "SHARED";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const toMs=(v)=>{if(!v)return 0;const d=new Date(v);return isNaN(d)?0:d.getTime();};

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
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function getRoom() {
  const data = await sbFetch("/rooms?code=eq." + FIXED_CODE + "&limit=1");
  return data?.[0] || null;
}

async function ensureRoom() {
  let room = await getRoom();
  if (!room) {
    await sbFetch("/rooms", {
      method: "POST",
      body: JSON.stringify({ code: FIXED_CODE, recipes: [], members: [] }),
    });
    room = { code: FIXED_CODE, recipes: [], members: [] };
  }
  return room;
}

async function upsertRoom(recipes, members) {
  await sbFetch("/rooms?code=eq." + FIXED_CODE, {
    method: "PATCH",
    body: JSON.stringify({
      recipes,
      members,
      updated_at: new Date().toISOString(),
    }),
  });
}

export default async function handler(req, res) {
  const { method } = req;

  if (method === "GET") {
    const { member } = req.query;
    const room = await ensureRoom();
    if (member && !(room.members || []).includes(member)) {
      room.members = [...(room.members || []), member];
      await upsertRoom(room.recipes || [], room.members);
    }
    return res.status(200).json({
      recipes: room.recipes || [],
      members: room.members || [],
    });
  }

  if (method === "POST") {
    const { recipes, member } = req.body;
    const room = await ensureRoom();

    const map = new Map();
    (room.recipes || []).forEach(r => map.set(r.id, r));
    (recipes || []).forEach(r => {
      const ex = map.get(r.id);
      if (!ex) { map.set(r.id, r); return; }
      const lu = toMs(ex.updatedAt || ex.addedAt);
      const ru = toMs(r.updatedAt || r.addedAt);
      if (ru > lu) map.set(r.id, r);
    });

    const merged = Array.from(map.values());
    const members = (room.members || []).includes(member)
      ? room.members
      : [...(room.members || []), member];

    await upsertRoom(merged, members);
    return res.status(200).json({ recipes: merged, members });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
