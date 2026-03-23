import { useState, useEffect, useRef } from "react";

const STORAGE_KEY = "recipe-note-local";

function parseJSONRobust(text) {
  if (!text || typeof text !== "string") return null;
  try { return JSON.parse(text.trim()); } catch {}
  const stripped = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  try { return JSON.parse(stripped); } catch {}
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s !== -1 && e > s) {
    try { return JSON.parse(text.slice(s, e + 1)); } catch {}
  }
  return null;
}

async function extractRecipe({ imageFile, text }) {
  let imageBase64 = null;
  let imageMediaType = null;
  if (imageFile) {
    imageBase64 = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onerror = () => rej(new Error("ファイル読み込み失敗"));
      reader.onload = () => res(reader.result.split(",")[1]);
      reader.readAsDataURL(imageFile);
    });
    imageMediaType = imageFile.type || "image/jpeg";
  }
  const prompt = imageFile
    ? "この画像に写っているレシピ情報を抽出してください。"
    : `以下のURL・テキストからレシピ情報を抽出してください:\n\n${text}`;
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, imageBase64, imageMediaType }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || `サーバーエラー (${res.status})`);
  }
  const data = await res.json();
  const parsed = parseJSONRobust(data.content);
  if (!parsed) throw new Error("解析失敗。別の画像やURLをお試しください。");
  return parsed;
}

const TAG_PALETTE = ["#e8825a","#5a9ee8","#5ac87a","#c85a8a","#c8a85a","#8a5ac8","#5ac8c8"];
const tagColor = (t) => TAG_PALETTE[Math.abs([...t].reduce((a,c)=>a+c.charCodeAt(0),0)) % TAG_PALETTE.length];

function Tag({ label, active, onClick }) {
  const c = tagColor(label);
  return (
    <span onClick={onClick} style={{
      background: active ? c+"33" : c+"14", color: c,
      border: "1px solid " + (active ? c+"77" : c+"30"),
      borderRadius: 20, padding: "3px 10px", fontSize: 11,
      fontWeight: 700, whiteSpace: "nowrap",
      cursor: onClick ? "pointer" : "default",
    }}>{label}</span>
  );
}

function Loader({ msg }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:14, padding:"40px 0" }}>
      <div style={{ display:"flex", gap:7 }}>
        {[0,1,2].map(i => (
          <div key={i} style={{
            width:10, height:10, borderRadius:"50%", background:"#e8825a",
            animation:"bop 1.1s ease-in-out " + (i*0.18) + "s infinite",
          }}/>
        ))}
      </div>
      <style>{"@keyframes bop{0%,80%,100%{transform:translateY(0);opacity:.3}40%{transform:translateY(-8px);opacity:1}}"}</style>
      <div style={{ color:"#e8825a", fontWeight:700, fontSize:13 }}>{msg}</div>
    </div>
  );
}

function Toast({ msg, onClear }) {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onClear, 3500);
    return () => clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  return (
    <div style={{
      position:"fixed", bottom:28, left:"50%", transform:"translateX(-50%)",
      background:"#17171f", color:"#f0eaff", padding:"12px 26px", borderRadius:30,
      fontSize:14, fontWeight:600, boxShadow:"0 8px 32px #000a",
      zIndex:9999, whiteSpace:"nowrap", border:"1px solid #2a2a40",
    }}>{msg}</div>
  );
}

function RecipeCard({ recipe, onClick, onDelete }) {
  const [hov, setHov] = useState(false);
  const cnt = (recipe.comments||[]).length;
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background:"#17171f",
        border:"1.5px solid " + (hov ? "#e8825a44" : "#25253a"),
        borderRadius:20, overflow:"hidden", cursor:"pointer", position:"relative",
        transform: hov ? "translateY(-5px)" : "translateY(0)",
        boxShadow: hov ? "0 14px 36px #e8825a18" : "0 2px 10px #0003",
        transition:"all 0.22s cubic-bezier(.34,1.56,.64,1)",
      }}
    >
      <div style={{
        height:90, background:"linear-gradient(135deg,#1e1a2e,#2a1e1a)",
        display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:48, position:"relative",
      }}>
        {recipe.emoji||"🍽️"}
        {cnt > 0 && (
          <span style={{
            position:"absolute", top:7, left:9, background:"#e8825a",
            color:"#fff", borderRadius:20, padding:"2px 7px", fontSize:10, fontWeight:700,
          }}>{"💬 " + cnt}</span>
        )}
      </div>
      <div style={{ padding:"11px 13px 13px" }}>
        <div style={{
          fontFamily:"'Zen Kaku Gothic New',sans-serif",
          fontSize:14, fontWeight:700, color:"#f0eaff", marginBottom:3, lineHeight:1.35,
        }}>{recipe.title}</div>
        <div style={{ fontSize:11, color:"#525265", marginBottom:8 }}>{recipe.description}</div>
        <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:8 }}>
          {(recipe.tags||[]).slice(0,3).map((t,i) => <Tag key={i} label={t}/>)}
        </div>
        <div style={{ display:"flex", gap:10, fontSize:11, color:"#464660" }}>
          {recipe.time && <span>{"⏱ " + recipe.time}</span>}
          {recipe.servings && <span>{"👥 " + recipe.servings}</span>}
          {recipe.addedBy && <span>{"👤 " + recipe.addedBy}</span>}
        </div>
      </div>
      {onDelete && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(recipe.id); }}
          style={{
            position:"absolute", top:8, right:8, background:"#ffffff0f",
            border:"none", borderRadius:"50%", width:26, height:26,
            cursor:"pointer", color:"#666", fontSize:12,
            display:"flex", alignItems:"center", justifyContent:"center",
          }}
        >✕</button>
      )}
    </div>
  );
}

function RecipeDetail({ recipe, onClose, onUpdate, userName }) {
  const [tab, setTab] = useState("recipe");
  const [commentText, setCommentText] = useState("");
  const [commentPhoto, setCommentPhoto] = useState(null);
  const [urlValue, setUrlValue] = useState(recipe.sourceUrl||"");
  const [editingUrl, setEditingUrl] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const photoRef = useRef();

  const handlePhotoSelect = async (file) => {
    if (!file) return;
    setPhotoLoading(true);
    try {
      const dataUrl = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result);
        reader.onerror = () => rej(new Error("写真読み込み失敗"));
        reader.readAsDataURL(file);
      });
      setCommentPhoto(dataUrl);
    } catch(e) { alert(e.message); }
    finally { setPhotoLoading(false); }
  };

  const submitComment = () => {
    if (!commentText.trim() && !commentPhoto) return;
    const comment = {
      id: Date.now(), author: userName,
      text: commentText.trim(), photo: commentPhoto,
      createdAt: new Date().toLocaleDateString("ja-JP"),
    };
    onUpdate({ ...recipe, comments: [...(recipe.comments||[]), comment] });
    setCommentText(""); setCommentPhoto(null);
  };

  const deleteComment = (id) =>
    onUpdate({ ...recipe, comments: (recipe.comments||[]).filter(c => c.id !== id) });

  const saveUrl = () => {
    onUpdate({ ...recipe, sourceUrl: urlValue.trim()||null });
    setEditingUrl(false);
  };

  return (
    <div onClick={onClose} style={{
      position:"fixed", inset:0, background:"#000d", zIndex:1000,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background:"#17171f", borderRadius:24, maxWidth:540, width:"100%",
        maxHeight:"90vh", overflowY:"auto",
        boxShadow:"0 30px 80px #000c", border:"1px solid #25253a",
      }}>
        <div style={{
          background:"linear-gradient(135deg,#1e1a2e,#2a1e1a)", height:130,
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:78, borderRadius:"24px 24px 0 0", position:"relative",
        }}>
          {recipe.emoji||"🍽️"}
          <button onClick={onClose} style={{
            position:"absolute", top:14, right:14, background:"#ffffff18",
            border:"none", borderRadius:"50%", width:33, height:33,
            cursor:"pointer", color:"#aaa", fontSize:15,
          }}>✕</button>
        </div>
        <div style={{ padding:"20px 24px 32px" }}>
          <div style={{
            fontFamily:"'Zen Kaku Gothic New',sans-serif",
            fontSize:22, fontWeight:900, color:"#f0eaff", marginBottom:4,
          }}>{recipe.title}</div>
          <div style={{ color:"#525265", fontSize:13, marginBottom:12 }}>{recipe.description}</div>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:14 }}>
            {(recipe.tags||[]).map((t,i) => <Tag key={i} label={t}/>)}
          </div>
          <div style={{
            display:"flex", gap:14, background:"#1e1e2e", borderRadius:12,
            padding:"10px 14px", marginBottom:16, fontSize:12, color:"#606080", flexWrap:"wrap",
          }}>
            {recipe.time && <span>{"⏱ " + recipe.time}</span>}
            {recipe.servings && <span>{"👥 " + recipe.servings}</span>}
            {recipe.source && <span>{"📌 " + recipe.source}</span>}
            {recipe.addedBy && <span>{"👤 " + recipe.addedBy}</span>}
            {recipe.addedAt && <span>{"📅 " + recipe.addedAt}</span>}
          </div>
          <div style={{
            background:"#1a1a28", borderRadius:12, padding:"11px 14px",
            marginBottom:18, border:"1px solid #25253a",
          }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:7 }}>
              <span style={{ fontSize:12, fontWeight:700, color:"#e8825a" }}>🔗 参照URL</span>
              <button
                onClick={() => { setEditingUrl(!editingUrl); setUrlValue(recipe.sourceUrl||""); }}
                style={{ background:"none", border:"none", color:"#555", fontSize:11, cursor:"pointer" }}
              >
                {editingUrl ? "キャンセル" : "編集"}
              </button>
            </div>
            {editingUrl ? (
              <div style={{ display:"flex", gap:8 }}>
                <input value={urlValue} onChange={e => setUrlValue(e.target.value)}
                  placeholder="https://..."
                  style={{ flex:1, padding:"8px 10px", borderRadius:8, border:"1px solid #2a2a40",
                    background:"#0f0f1a", color:"#d0d0f0", fontSize:12, outline:"none" }}/>
                <button onClick={saveUrl} style={{
                  background:"#e8825a", border:"none", borderRadius:8,
                  padding:"8px 14px", color:"#fff", fontSize:12, fontWeight:700, cursor:"pointer",
                }}>保存</button>
              </div>
            ) : recipe.sourceUrl ? (
              <a href={recipe.sourceUrl} target="_blank" rel="noreferrer"
                style={{ color:"#5a9ee8", fontSize:12, wordBreak:"break-all", textDecoration:"none" }}>
                {recipe.sourceUrl}
              </a>
            ) : (
              <div style={{ color:"#3a3a50", fontSize:12 }}>URLが未設定 — 編集から追加できます</div>
            )}
          </div>
          <div style={{ display:"flex", background:"#1a1a28", borderRadius:12, padding:4, marginBottom:18 }}>
            {[
              { id:"recipe", label:"📋 レシピ" },
              { id:"comments", label:"💬 記録" + ((recipe.comments||[]).length > 0 ? " (" + recipe.comments.length + ")" : "") },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                flex:1, padding:"9px", borderRadius:10, border:"none",
                background: tab===t.id ? "#e8825a" : "transparent",
                color: tab===t.id ? "#fff" : "#555",
                fontWeight: tab===t.id ? 700 : 400, cursor:"pointer", fontSize:12,
              }}>{t.label}</button>
            ))}
          </div>
          {tab==="recipe" && (
            <div>
              {recipe.ingredients && recipe.ingredients.length > 0 && (
                <div style={{ marginBottom:20 }}>
                  <div style={{ fontWeight:700, color:"#e8825a", fontSize:12, marginBottom:10 }}>▸ 材料</div>
                  <div style={{ background:"#1a1a2a", borderRadius:12, padding:"6px 14px", border:"1px solid #25253a" }}>
                    {recipe.ingredients.map((ing,i) => (
                      <div key={i} style={{
                        display:"flex", justifyContent:"space-between", padding:"7px 0",
                        borderBottom: i < recipe.ingredients.length-1 ? "1px solid #25253a" : "none",
                        fontSize:13,
                      }}>
                        <span style={{ color:"#d0c8e0" }}>{ing.name}</span>
                        <span style={{ color:"#555" }}>{ing.amount}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {recipe.steps && recipe.steps.length > 0 && (
                <div>
                  <div style={{ fontWeight:700, color:"#e8825a", fontSize:12, marginBottom:10 }}>▸ 作り方</div>
                  {recipe.steps.map((step,i) => (
                    <div key={i} style={{ display:"flex", gap:12, marginBottom:13, alignItems:"flex-start" }}>
                      <div style={{
                        background:"linear​​​​​​​​​​​​​​​​
