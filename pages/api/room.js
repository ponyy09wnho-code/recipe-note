const store = {};

function generateCode(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({length:6},()=>chars[Math.floor(Math.random()*chars.length)]).join("");
}

export const config = {
  api: { bodyParser: { sizeLimit: "5mb" } }
};

export default async function handler(req, res){
  const { method } = req;

  if(method === "PUT"){
    const { member } = req.body;
    let code;
    do { code = generateCode(); } while(store[code]);
    store[code] = { code, recipes:[], members:[member], createdAt:Date.now(), updatedAt:Date.now() };
    return res.status(200).json({ code });
  }

  if(method === "GET"){
    const { code, member } = req.query;
    if(!code) return res.status(400).json({ error:"コードが必要です" });
    let room = store[code];
    if(!room) return res.status(404).json({ error:"ルームが見つかりません" });
    if(member && !room.members.includes(member)){ room.members.push(member); store[code]=room; }
    return res.status(200).json({ code:room.code, recipes:room.recipes, members:room.members });
  }

  if(method === "POST"){
    const { code, recipes, member } = req.body;
    if(!code) return res.status(400).json({ error:"コードが必要です" });
    let room = store[code];
    if(!room) return res.status(404).json({ error:"ルームが見つかりません" });
    const map = new Map();
    (room.recipes||[]).forEach(r=>map.set(r.id,r));
    (recipes||[]).forEach(r=>{
      const ex=map.get(r.id);
      if(!ex){ map.set(r.id,r); }
      else {
        const lu=ex.updatedAt||ex.addedAt||"";
        const ru=r.updatedAt||r.addedAt||"";
        if(ru>=lu) map.set(r.id,r);
      }
    });
    room.recipes=Array.from(map.values());
    room.updatedAt=Date.now();
    if(member&&!room.members.includes(member)) room.members.push(member);
    store[code]=room;
    return res.status(200).json({ recipes:room.recipes, members:room.members });
  }

  return res.status(405).json({ error:"Method not allowed" });
}
