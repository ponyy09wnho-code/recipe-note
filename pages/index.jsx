import { useState, useEffect, useRef } from "react";

const STORAGE_KEY = "recipe-note-local";
const G = { dark:"#0a0a12", card:"#13132a", input:"#1a1a30", border:"#2a2a45", text:"#f0eaff", sub:"#8888aa", accent:"#e8825a", accent2:"#c85a8a" };

function scaleAmount(str, scale) {
  if (!str || scale === 1) return str;
  return str.replace(/(\d+\.?\d*)/g, (m) => {
    const n = parseFloat(m) * scale;
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  });
}

function parseJSONRobust(text) {
  if (!text || typeof text !== "string") return null;
  try { return JSON.parse(text.trim()); } catch {}
  const stripped = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  try { return JSON.parse(stripped); } catch {}
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s !== -1 && e > s) { try { return JSON.parse(text.slice(s, e + 1)); } catch {} }
  return null;
}

async function extractRecipe({ imageFile, text }) {
  let imageBase64 = null, imageMediaType = null;
  if (imageFile) {
    imageBase64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onerror = () => rej(new Error("読み込み失敗"));
      r.onload = () => res(r.result.split(",")[1]);
      r.readAsDataURL(imageFile);
    });
    imageMediaType = imageFile.type || "image/jpeg";
  }
  const prompt = imageFile ? "この画像からレシピ情報を抽出してください。" : "以下からレシピを抽出してください:\n\n" + text;
  const res = await fetch("/api/ai", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, imageBase64, imageMediaType }),
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e?.error || "エラー"); }
  const data = await res.json();
  const parsed = parseJSONRobust(data.content);
  if (!parsed) throw new Error("解析失敗。別の画像やURLをお試しください。");
  return parsed;
}

async function readFileAsDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error("読み込み失敗"));
    r.readAsDataURL(file);
  });
}

const TAG_CATEGORIES = [
  { label:"🍱 ジャンル", tags:["和食","洋食","中華","韓国料理","イタリアン","エスニック","デザート","スープ"] },
  { label:"🥦 野菜", tags:["葉野菜","根菜","豆類","きのこ","トマト","なす","じゃがいも","玉ねぎ","ブロッコリー"] },
  { label:"🥩 食材", tags:["鶏肉","豚肉","牛肉","魚介","卵","豆腐","乳製品","パスタ","米"] },
  { label:"⏱ 手間", tags:["簡単","時短","本格","下準備あり","作り置き","5分","15分","30分"] },
  { label:"🍽 用途", tags:["主菜","副菜","汁物","お弁当","おつまみ","朝食","パーティー"] },
];

const PALETTE = ["#e8825a","#5a9ee8","#5ac87a","#c85a8a","#c8a85a","#8a5ac8","#5ac8c8","#e8c05a"];
const tagColor = (t) => PALETTE[Math.abs([...t].reduce((a,c)=>a+c.charCodeAt(0),0)) % PALETTE.length];

const base = {
  input: { padding:"11px 14px", borderRadius:12, border:"1.5px solid "+G.border, background:G.input, color:G.text, fontSize:14, outline:"none", boxSizing:"border-box", width:"100%" },
  btn: (bg, color="#fff") => ({ border:"none", borderRadius:12, padding:"10px 18px", background:bg, color, fontWeight:700, fontSize:14, cursor:"pointer" }),
};

function ConfirmDialog({ msg, onOk, onCancel }) {
  return (
    <div onClick={onCancel} style={{ position:"fixed", inset:0, background:"#000c", zIndex:3000, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:G.card, borderRadius:20, padding:"24px 22px", maxWidth:320, width:"100%", border:"2px solid #e8825a66", boxShadow:"0 16px 48px #000a" }}>
        <div style={{ fontSize:16, fontWeight:700, color:G.text, marginBottom:18, lineHeight:1.6 }}>{msg}</div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={onCancel} style={{ flex:1, padding:"11px", borderRadius:12, border:"1.5px solid "+G.border, background:G.input, color:G.sub, fontWeight:700, cursor:"pointer", fontSize:14 }}>キャンセル</button>
          <button onClick={onOk} style={{ flex:1, padding:"11px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#e85a5a,#c83a3a)", color:"#fff", fontWeight:700, cursor:"pointer", fontSize:14 }}>削除する</button>
        </div>
      </div>
    </div>
  );
}

function Toast({ msg, onClear }) {
  useEffect(() => { if (!msg) return; const t = setTimeout(onClear, 3200); return () => clearTimeout(t); }, [msg]);
  if (!msg) return null;
  return (
    <div style={{ position:"fixed", bottom:28, left:"50%", transform:"translateX(-50%)", background:"linear-gradient(135deg,#e8825a,#c8603a)", color:"#fff", padding:"12px 26px", borderRadius:30, fontSize:14, fontWeight:700, boxShadow:"0 8px 32px #e8825a44", zIndex:9999, whiteSpace:"nowrap" }}>{msg}</div>
  );
}

function Loader({ msg }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:14, padding:"36px 0" }}>
      <div style={{ display:"flex", gap:7 }}>
        {[0,1,2].map(i=><div key={i} style={{ width:10, height:10, borderRadius:"50%", background:G.accent, animation:"bop 1.1s ease-in-out "+(i*0.18)+"s infinite" }}/>)}
      </div>
      <style>{"@keyframes bop{0%,80%,100%{transform:translateY(0);opacity:.3}40%{transform:translateY(-8px);opacity:1}}"}</style>
      <div style={{ color:G.accent, fontWeight:700, fontSize:13 }}>{msg}</div>
    </div>
  );
}

function Tag({ label, active, onClick, onRemove }) {
  const c = tagColor(label);
  return (
    <span onClick={onClick} style={{ background:active?c:c+"22", color:active?"#fff":c, border:"1.5px solid "+c, borderRadius:20, padding:onRemove?"3px 6px 3px 10px":"3px 10px", fontSize:11, fontWeight:700, whiteSpace:"nowrap", cursor:onClick?"pointer":"default", display:"inline-flex", alignItems:"center", gap:4, transition:"all 0.15s" }}>
      {label}
      {onRemove && <span onClick={e=>{e.stopPropagation();onRemove();}} style={{ fontSize:10, opacity:0.8, cursor:"pointer" }}>✕</span>}
    </span>
  );
}

function TagEditor({ tags, onSave, onClose }) {
  const [current, setCurrent] = useState([...tags]);
  const [custom, setCustom] = useState("");
  const toggle = (t) => setCurrent(p=>p.includes(t)?p.filter(x=>x!==t):[...p,t]);
  const addCustom = () => { if (!custom.trim()||current.includes(custom.trim())) return; setCurrent(p=>[...p,custom.trim()]); setCustom(""); };
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"#000c", zIndex:2000, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:G.card, borderRadius:"24px 24px 0 0", width:"100%", maxWidth:540, padding:"20px 20px 40px", maxHeight:"75vh", overflowY:"auto", border:"2px solid "+G.accent+"44" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <div style={{ fontWeight:700, color:G.text, fontSize:16 }}>🏷 タグを編集</div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:G.sub, fontSize:20, cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ display:"flex", gap:8, marginBottom:14 }}>
          <input value={custom} onChange={e=>setCustom(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCustom()} placeholder="カスタムタグ..." style={{ ...base.input, flex:1 }}/>
          <button onClick={addCustom} style={{ ...base.btn("linear-gradient(135deg,#e8825a,#c8603a)"), flexShrink:0 }}>追加</button>
        </div>
        {current.length>0&&<div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:14, padding:10, background:G.input, borderRadius:12 }}>{current.map((t,i)=><Tag key={i} label={t} active onRemove={()=>toggle(t)}/>)}</div>}
        {TAG_CATEGORIES.map((cat,ci)=>(
          <div key={ci} style={{ marginBottom:14 }}>
            <div style={{ fontSize:12, color:G.sub, fontWeight:700, marginBottom:7 }}>{cat.label}</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>{cat.tags.map((t,ti)=><Tag key={ti} label={t} active={current.includes(t)} onClick={()=>toggle(t)}/>)}</div>
          </div>
        ))}
        <button onClick={()=>onSave(current)} style={{ width:"100%", marginTop:10, padding:"14px", borderRadius:14, border:"none", background:"linear-gradient(135deg,#e8825a,#c8603a)", color:"#fff", fontSize:15, fontWeight:700, cursor:"pointer" }}>保存する</button>
      </div>
    </div>
  );
}

function RecipeCard({ recipe, onClick, onDelete }) {
  const [hov, setHov] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const c1 = tagColor(recipe.title||"a");
  const c2 = tagColor((recipe.tags||["b"])[0]||"b");
  const cnt = (recipe.comments||[]).length;
  return (
    <>
      {confirmDelete && <ConfirmDialog msg={"「"+recipe.title+"」を削除しますか？"} onOk={()=>{setConfirmDelete(false);onDelete(recipe.id);}} onCancel={()=>setConfirmDelete(false)}/>}
      <div onClick={onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)} style={{ background:G.card, border:"2px solid "+(hov?c1:G.border), borderRadius:20, overflow:"hidden", cursor:"pointer", position:"relative", transform:hov?"translateY(-6px) scale(1.02)":"translateY(0) scale(1)", boxShadow:hov?"0 16px 40px "+c1+"44":"0 4px 14px #0004", transition:"all 0.22s cubic-bezier(.34,1.56,.64,1)" }}>
        <div style={{ height:100, background:recipe.photo?"url("+recipe.photo+") center/cover":"linear-gradient(135deg,"+c1+"55,"+c2+"33)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:50, position:"relative" }}>
          {!recipe.photo&&(recipe.emoji||"🍽️")}
          {cnt>0&&<span style={{ position:"absolute", top:8, left:8, background:"linear-gradient(135deg,#e8825a,#c85a8a)", color:"#fff", borderRadius:20, padding:"2px 8px", fontSize:10, fontWeight:700 }}>{"💬 "+cnt}</span>}
        </div>
        <div style={{ padding:"11px 13px 13px" }}>
          <div style={{ fontFamily:"'Zen Kaku Gothic New',sans-serif", fontSize:14, fontWeight:700, color:G.text, marginBottom:3, lineHeight:1.35 }}>{recipe.title}</div>
          <div style={{ fontSize:11, color:G.sub, marginBottom:8 }}>{recipe.description}</div>
          <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:8 }}>{(recipe.tags||[]).slice(0,3).map((t,i)=><Tag key={i} label={t}/>)}</div>
          <div style={{ display:"flex", gap:10, fontSize:11, color:"#666688" }}>
            {recipe.time&&<span>{"⏱ "+recipe.time}</span>}
            {recipe.servings&&<span>{"👥 "+recipe.servings}</span>}
            {recipe.addedBy&&<span>{"👤 "+recipe.addedBy}</span>}
          </div>
        </div>
        {onDelete&&<button onClick={e=>{e.stopPropagation();setConfirmDelete(true);}} style={{ position:"absolute", top:8, right:8, background:"#000a", backdropFilter:"blur(4px)", border:"none", borderRadius:"50%", width:26, height:26, cursor:"pointer", color:"#ccc", fontSize:12, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>}
      </div>
    </>
  );
}

function RecipeDetail({ recipe, onClose, onUpdate, userName }) {
  const [tab, setTab] = useState("recipe");
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState(null);
  const [commentText, setCommentText] = useState("");
  const [commentPhoto, setCommentPhoto] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [showTagEditor, setShowTagEditor] = useState(false);
  const [confirmDeleteComment, setConfirmDeleteComment] = useState(null);
  const [servings, setServings] = useState(()=>{ const n=parseInt(recipe.servings); return isNaN(n)?2:n; });
  const baseServings = parseInt(recipe.servings)||2;
  const scale = servings/baseServings;
  const c1 = tagColor(recipe.title||"a");
  const photoRef = useRef();
  const heroPhotoRef = useRef();
  const stepPhotoRefs = useRef([]);

  const startEdit = () => {
    setEditData({
      title: recipe.title||"",
      description: recipe.description||"",
      emoji: recipe.emoji||"🍳",
      time: recipe.time||"",
      servings: String(parseInt(recipe.servings)||2),
      source: recipe.source||"",
      sourceUrl: recipe.sourceUrl||"",
      tags: [...(recipe.tags||[])],
      ingredients: (recipe.ingredients||[]).length>0 ? [...recipe.ingredients] : [{name:"",amount:""}],
      steps: (recipe.steps||[]).length>0 ? [...recipe.steps] : [""],
    });
    setEditing(true);
  };

  const saveEdit = () => {
    if (!editData.title.trim()) return;
    onUpdate({
      ...recipe,
      title: editData.title.trim(),
      description: editData.description.trim(),
      emoji: editData.emoji,
      time: editData.time.trim()||null,
      servings: editData.servings ? editData.servings+"人分" : null,
      source: editData.source.trim()||null,
      sourceUrl: editData.sourceUrl.trim()||null,
      tags: editData.tags,
      ingredients: editData.ingredients.filter(i=>i.name.trim()),
      steps: editData.steps.filter(s=>s.trim()),
    });
    setEditing(false);
  };

  const handleHeroPhoto = async (file) => { if(!file) return; const d=await readFileAsDataUrl(file); onUpdate({...recipe,photo:d}); };
  const handleStepPhoto = async (file,idx) => { if(!file) return; const d=await readFileAsDataUrl(file); const sp={...(recipe.stepPhotos||{})}; sp[idx]=d; onUpdate({...recipe,stepPhotos:sp}); };
  const handleCommentPhoto = async (file) => { if(!file) return; setPhotoLoading(true); try { setCommentPhoto(await readFileAsDataUrl(file)); } catch(e){alert(e.message);} finally{setPhotoLoading(false);} };

  const submitComment = () => {
    if (!commentText.trim()&&!commentPhoto) return;
    onUpdate({...recipe,comments:[...(recipe.comments||[]),{id:Date.now(),author:userName,text:commentText.trim(),photo:commentPhoto,createdAt:new Date().toLocaleDateString("ja-JP")}]});
    setCommentText(""); setCommentPhoto(null);
  };

  const inStyle = { padding:"9px 12px", borderRadius:10, border:"1.5px solid "+G.border, background:G.input, color:G.text, fontSize:13, outline:"none", boxSizing:"border-box" };

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"#000d", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      {showTagEditor&&<TagEditor tags={editing?editData.tags:recipe.tags||[]} onSave={tags=>{if(editing)setEditData(d=>({...d,tags}));else onUpdate({...recipe,tags});setShowTagEditor(false);}} onClose={()=>setShowTagEditor(false)}/>}
      {confirmDeleteComment&&<ConfirmDialog msg="この記録を削除しますか？" onOk={()=>{onUpdate({...recipe,comments:(recipe.comments||[]).filter(c=>c.id!==confirmDeleteComment)});setConfirmDeleteComment(null);}} onCancel={()=>setConfirmDeleteComment(null)}/>}

      <div onClick={e=>e.stopPropagation()} style={{ background:G.dark, borderRadius:24, maxWidth:540, width:"100%", maxHeight:"90vh", overflowY:"auto", boxShadow:"0 30px 80px #000c", border:"2px solid "+c1+"55" }}>
        {/* Hero */}
        <div style={{ height:150, background:recipe.photo?"url("+recipe.photo+") center/cover":"linear-gradient(135deg,"+c1+"66,#1e1a2e)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:82, borderRadius:"22px 22px 0 0", position:"relative" }}>
          {!recipe.photo&&(recipe.emoji||"🍽️")}
          <button onClick={onClose} style={{ position:"absolute", top:12, right:12, background:"#000a", backdropFilter:"blur(4px)", border:"none", borderRadius:"50%", width:34, height:34, cursor:"pointer", color:"#fff", fontSize:16 }}>✕</button>
          <input ref={heroPhotoRef} type="file" accept="image/*" style={{ display:"none" }} onChange={e=>{const f=e.target.files?.[0];if(f)handleHeroPhoto(f);e.target.value="";}}/>
          <div style={{ position:"absolute", bottom:10, right:12, display:"flex", gap:6 }}>
            <button onClick={()=>heroPhotoRef.current?.click()} style={{ background:"#000a", backdropFilter:"blur(4px)", border:"1px solid #ffffff44", borderRadius:10, padding:"5px 10px", color:"#fff", fontSize:11, cursor:"pointer" }}>📷 写真変更</button>
            <button onClick={startEdit} style={{ background:"linear-gradient(135deg,#e8825a,#c8603a)", border:"none", borderRadius:10, padding:"5px 10px", color:"#fff", fontSize:11, fontWeight:700, cursor:"pointer" }}>✏️ 編集</button>
          </div>
        </div>

        <div style={{ padding:"18px 20px 30px" }}>
          {editing ? (
            /* ── EDIT MODE ── */
            <div>
              <div style={{ fontFamily:"'Zen Kaku Gothic New',sans-serif", fontSize:18, fontWeight:900, color:G.accent, marginBottom:16 }}>✏️ レシピを編集</div>
              <div style={{ display:"flex", gap:10, marginBottom:12 }}>
                <input value={editData.emoji} onChange={e=>setEditData(d=>({...d,emoji:e.target.value}))} style={{ ...inStyle, width:56, textAlign:"center", fontSize:22, padding:"8px" }}/>
                <input value={editData.title} onChange={e=>setEditData(d=>({...d,title:e.target.value}))} placeholder="料理名" style={{ ...inStyle, flex:1 }}/>
              </div>
              <input value={editData.description} onChange={e=>setEditData(d=>({...d,description:e.target.value}))} placeholder="一言説明" style={{ ...inStyle, width:"100%", marginBottom:10 }}/>
              <div style={{ display:"flex", gap:10, marginBottom:10 }}>
                <input value={editData.time} onChange={e=>setEditData(d=>({...d,time:e.target.value}))} placeholder="調理時間" style={{ ...inStyle, flex:1 }}/>
                <input value={editData.servings} onChange={e=>setEditData(d=>({...d,servings:e.target.value}))} placeholder="人数" type="number" min="1" style={{ ...inStyle, flex:1 }}/>
              </div>
              <input value={editData.source} onChange={e=>setEditData(d=>({...d,source:e.target.value}))} placeholder="出典・SNS" style={{ ...inStyle, width:"100%", marginBottom:10 }}/>
              <input value={editData.sourceUrl} onChange={e=>setEditData(d=>({...d,sourceUrl:e.target.value}))} placeholder="参照URL" style={{ ...inStyle, width:"100%", marginBottom:14 }}/>

              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:12, color:G.sub, marginBottom:8 }}>🏷 タグ</div>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:8 }}>
                  {editData.tags.map((t,i)=><Tag key={i} label={t} active onRemove={()=>setEditData(d=>({...d,tags:d.tags.filter((_,idx)=>idx!==i)}))}/>)}
                  <button onClick={()=>setShowTagEditor(true)} style={{ background:G.accent+"22", border:"1.5px dashed "+G.accent+"88", borderRadius:20, padding:"3px 10px", color:G.accent, fontSize:11, fontWeight:700, cursor:"pointer" }}>＋ タグ編集</button>
                </div>
              </div>

              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:12, color:G.sub, marginBottom:8 }}>🥘 材料</div>
                {editData.ingredients.map((ing,i)=>(
                  <div key={i} style={{ display:"flex", gap:8, marginBottom:8 }}>
                    <input value={ing.name} onChange={e=>{const a=[...editData.ingredients];a[i]={...a[i],name:e.target.value};setEditData(d=>({...d,ingredients:a}));}} placeholder="材料名" style={{ ...inStyle, flex:2 }}/>
                    <input value={ing.amount} onChange={e=>{const a=[...editData.ingredients];a[i]={...a[i],amount:e.target.value};setEditData(d=>({...d,ingredients:a}));}} placeholder="分量" style={{ ...inStyle, flex:1 }}/>
                    <button onClick={()=>setEditData(d=>({...d,ingredients:d.ingredients.filter((_,idx)=>idx!==i)}))} style={{ background:G.input, border:"none", borderRadius:8, width:34, color:G.sub, cursor:"pointer", fontSize:14, flexShrink:0 }}>✕</button>
                  </div>
                ))}
                <button onClick={()=>setEditData(d=>({...d,ingredients:[...d.ingredients,{name:"",amount:""}]}))} style={{ width:"100%", padding:9, borderRadius:10, border:"1.5px dashed "+G.border, background:G.input, color:G.sub, fontSize:13, cursor:"pointer" }}>＋ 材料を追加</button>
              </div>

              <div style={{ marginBottom:18 }}>
                <div style={{ fontSize:12, color:G.sub, marginBottom:8 }}>👨‍🍳 作り方</div>
                {editData.steps.map((step,i)=>(
                  <div key={i} style={{ display:"flex", gap:8, marginBottom:8, alignItems:"flex-start" }}>
                    <div style={{ background:"linear-gradient(135deg,#5ac87a,#3aa85a)", color:"#fff", borderRadius:"50%", minWidth:26, height:26, marginTop:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700 }}>{i+1}</div>
                    <textarea value={step} onChange={e=>{const a=[...editData.steps];a[i]=e.target.value;setEditData(d=>({...d,steps:a}));}} rows={2} placeholder={"手順 "+(i+1)} style={{ ...inStyle, flex:1, resize:"vertical" }}/>
                    <button onClick={()=>setEditData(d=>({...d,steps:d.steps.filter((_,idx)=>idx!==i)}))} style={{ background:G.input, border:"none", borderRadius:8, width:34, height:34, marginTop:4, color:G.sub, cursor:"pointer", fontSize:14, flexShrink:0 }}>✕</button>
                  </div>
                ))}
                <button onClick={()=>setEditData(d=>({...d,steps:[...d.steps,""]}))} style={{ width:"100%", padding:9, borderRadius:10, border:"1.5px dashed "+G.border, background:G.input, color:G.sub, fontSize:13, cursor:"pointer" }}>＋ 手順を追加</button>
              </div>

              <div style={{ display:"flex", gap:10 }}>
                <button onClick={()=>setEditing(false)} style={{ flex:1, padding:"12px", borderRadius:12, border:"1.5px solid "+G.border, background:G.input, color:G.sub, fontWeight:700, cursor:"pointer", fontSize:14 }}>キャンセル</button>
                <button onClick={saveEdit} style={{ flex:2, padding:"12px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#e8825a,#c8603a)", color:"#fff", fontWeight:700, cursor:"pointer", fontSize:14 }}>💾 保存する</button>
              </div>
            </div>
          ) : (
            /* ── VIEW MODE ── */
            <div>
              <div style={{ fontFamily:"'Zen Kaku Gothic New',sans-serif", fontSize:22, fontWeight:900, color:G.text, marginBottom:4 }}>{recipe.title}</div>
              <div style={{ color:G.sub, fontSize:13, marginBottom:12 }}>{recipe.description}</div>
              <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:14, alignItems:"center" }}>
                {(recipe.tags||[]).map((t,i)=><Tag key={i} label={t}/>)}
                <button onClick={()=>setShowTagEditor(true)} style={{ background:G.accent+"22", border:"1.5px dashed "+G.accent+"88", borderRadius:20, padding:"3px 10px", color:G.accent, fontSize:11, fontWeight:700, cursor:"pointer" }}>＋ タグ</button>
              </div>

              <div style={{ display:"flex", gap:10, background:G.card, borderRadius:14, padding:"10px 14px", marginBottom:14, fontSize:12, color:G.sub, flexWrap:"wrap", alignItems:"center" }}>
                {recipe.time&&<span>{"⏱ "+recipe.time}</span>}
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span>👥</span>
                  <button onClick={()=>setServings(Math.max(1,servings-1))} style={{ background:G.input, border:"none", borderRadius:6, width:22, height:22, color:"#fff", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>-</button>
                  <span style={{ fontWeight:700, color:scale!==1?G.accent:G.text, minWidth:20, textAlign:"center" }}>{servings}</span>
                  <button onClick={()=>setServings(servings+1)} style={{ background:G.input, border:"none", borderRadius:6, width:22, height:22, color:"#fff", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>+</button>
                  <span>人分</span>
                </div>
                {recipe.addedBy&&<span>{"👤 "+recipe.addedBy}</span>}
                {recipe.addedAt&&<span>{"📅 "+recipe.addedAt}</span>}
              </div>

              {(recipe.source||recipe.sourceUrl)&&(
                <div style={{ background:G.card, borderRadius:12, padding:"10px 14px", marginBottom:16, border:"1.5px solid "+G.accent+"33" }}>
                  {recipe.source&&<div style={{ fontSize:12, color:G.sub, marginBottom:4 }}>{"📌 "+recipe.source}</div>}
                  {recipe.sourceUrl&&<a href={recipe.sourceUrl} target="_blank" rel="noreferrer" style={{ color:"#5a9ee8", fontSize:12, wordBreak:"break-all", textDecoration:"none" }}>{recipe.sourceUrl}</a>}
                </div>
              )}

              <div style={{ display:"flex", background:G.card, borderRadius:14, padding:4, marginBottom:18, gap:4 }}>
                {[{id:"recipe",label:"📋 レシピ"},{id:"comments",label:"💬 記録"+((recipe.comments||[]).length>0?" ("+(recipe.comments.length+")"):"")}].map(t=>(
                  <button key={t.id} onClick={()=>setTab(t.id)} style={{ flex:1, padding:"9px", borderRadius:11, border:"none", background:tab===t.id?"linear-gradient(135deg,#e8825a,#c8603a)":"transparent", color:tab===t.id?"#fff":G.sub, fontWeight:tab===t.id?700:400, cursor:"pointer", fontSize:12 }}>{t.label}</button>
                ))}
              </div>

              {tab==="recipe"&&(
                <div>
                  {recipe.ingredients&&recipe.ingredients.length>0&&(
                    <div style={{ marginBottom:20 }}>
                      <div style={{ fontWeight:700, color:G.accent, fontSize:13, marginBottom:10 }}>
                        {"🥘 材料"}
                        {scale!==1&&<span style={{ fontWeight:400, color:G.accent, fontSize:11, marginLeft:8 }}>{"（×"+scale.toFixed(1)+" 換算）"}</span>}
                      </div>
                      <div style={{ background:G.card, borderRadius:14, padding:"6px 14px", border:"1.5px solid "+G.accent+"33" }}>
                        {recipe.ingredients.map((ing,i)=>(
                          <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:i<recipe.ingredients.length-1?"1px solid "+G.border+"66":"none", fontSize:13 }}>
                            <span style={{ color:G.text }}>{ing.name}</span>
                            <span style={{ color:scale!==1?G.accent:G.sub, fontWeight:scale!==1?700:400 }}>{scaleAmount(ing.amount,scale)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {recipe.steps&&recipe.steps.length>0&&(
                    <div>
                      <div style={{ fontWeight:700, color:"#5ac87a", fontSize:13, marginBottom:10 }}>👨‍🍳 作り方</div>
                      {recipe.steps.map((step,i)=>(
                        <div key={i} style={{ background:G.card, borderRadius:14, padding:"12px 14px", marginBottom:10, border:"1.5px solid #5ac87a33" }}>
                          <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                            <div style={{ background:"linear-gradient(135deg,#5ac87a,#3aa85a)", color:"#fff", borderRadius:"50%", minWidth:26, height:26, marginTop:1, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700 }}>{i+1}</div>
                            <div style={{ flex:1, fontSize:13, color:G.text, lineHeight:1.75 }}>{step}</div>
                            <div>
                              <input ref={el=>{stepPhotoRefs.current[i]=el;}} type="file" accept="image/*" style={{ display:"none" }} onChange={e=>{const f=e.target.files?.[0];if(f)handleStepPhoto(f,i);e.target.value="";}}/>
                              <button onClick={()=>stepPhotoRefs.current[i]?.click()} style={{ background:G.input, border:"none", borderRadius:8, padding:"4px 8px", color:G.sub, fontSize:11, cursor:"pointer" }}>📷</button>
                            </div>
                          </div>
                          {recipe.stepPhotos&&recipe.stepPhotos[i]&&(
                            <div style={{ position:"relative", marginTop:10 }}>
                              <img src={recipe.stepPhotos[i]} alt={"手順"+(i+1)} style={{ width:"100%", borderRadius:10, maxHeight:200, objectFit:"cover" }}/>
                              <button onClick={()=>{const sp={...(recipe.stepPhotos||{})};delete sp[i];onUpdate({...recipe,stepPhotos:sp});}} style={{ position:"absolute", top:6, right:6, background:"#000a", border:"none", borderRadius:"50%", width:24, height:24, cursor:"pointer", color:"#fff", fontSize:12 }}>✕</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab==="comments"&&(
                <div>
                  {(recipe.comments||[]).length===0?(
                    <div style={{ textAlign:"center", padding:"28px 0" }}>
                      <div style={{ fontSize:40, marginBottom:10 }}>📷</div>
                      <div style={{ fontSize:13, color:G.sub }}>まだ記録がありません</div>
                    </div>
                  ):(
                    <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:20 }}>
                      {(recipe.comments||[]).map(c=>(
                        <div key={c.id} style={{ background:G.card, borderRadius:14, padding:"12px 14px", border:"1.5px solid "+G.border }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:9 }}>
                            <div style={{ width:28, height:28, borderRadius:"50%", flexShrink:0, background:"linear-gradient(135deg,#e8825a,#8a5ac8)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:"#fff" }}>{(c.author||"?")[0].toUpperCase()}</div>
                            <div style={{ flex:1 }}>
                              <div style={{ fontSize:12, fontWeight:700, color:G.text }}>{c.author}</div>
                              <div style={{ fontSize:10, color:G.sub }}>{c.createdAt}</div>
                            </div>
                            {c.author===userName&&<button onClick={()=>setConfirmDeleteComment(c.id)} style={{ background:"none", border:"none", color:"#e85a5a", cursor:"pointer", fontSize:13 }}>🗑</button>}
                          </div>
                          {c.photo&&<img src={c.photo} alt="投稿写真" style={{ width:"100%", borderRadius:10, marginBottom:c.text?9:0, maxHeight:240, objectFit:"cover" }}/>}
                          {c.text&&<div style={{ fontSize:13, color:"#c0b8d0", lineHeight:1.75 }}>{c.text}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ background:G.card, borderRadius:16, padding:14, border:"1.5px solid "+G.border }}>
                    <div style={{ fontSize:12, fontWeight:700, color:G.accent, marginBottom:10 }}>▸ 記録を追加</div>
                    <textarea value={commentText} onChange={e=>setCommentText(e.target.value)} placeholder="感想・アレンジ・メモなど..." rows={3} style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:"1.5px solid "+G.border, background:G.input, color:G.text, fontSize:13, outline:"none", resize:"none", boxSizing:"border-box", lineHeight:1.6, marginBottom:10 }}/>
                    {photoLoading&&<div style={{ color:G.accent, fontSize:12, marginBottom:8, textAlign:"center" }}>読み込み中...</div>}
                    {commentPhoto&&!photoLoading&&(
                      <div style={{ position:"relative", marginBottom:10 }}>
                        <img src={commentPhoto} alt="preview" style={{ width:"100%", borderRadius:10, maxHeight:180, objectFit:"cover" }}/>
                        <button onClick={()=>setCommentPhoto(null)} style={{ position:"absolute", top:7, right:7, background:"#000b", border:"none", borderRadius:"50%", width:28, height:28, cursor:"pointer", color:"#fff", fontSize:14 }}>✕</button>
                      </div>
                    )}
                    <input ref={photoRef} type="file" accept="image/*" style={{ display:"none" }} onChange={e=>{const f=e.target.files?.[0];if(f)handleCommentPhoto(f);e.target.value="";}}/>
                    <div style={{ display:"flex", gap:8 }}>
                      <button onClick={()=>photoRef.current?.click()} style={{ padding:"9px 14px", borderRadius:10, border:"1.5px solid "+G.border, background:G.input, color:G.sub, fontSize:12, cursor:"pointer", whiteSpace:"nowrap" }}>📷 写真</button>
                      <button onClick={submitComment} disabled={!commentText.trim()&&!commentPhoto} style={{ flex:1, padding:"9px", borderRadius:10, border:"none", background:(!commentText.trim()&&!commentPhoto)?G.input:"linear-gradient(135deg,#e8825a,#c8603a)", color:"#fff", fontSize:13, fontWeight:700, cursor:(!commentText.trim()&&!commentPhoto)?"default":"pointer" }}>投稿する</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ManualForm({ onAdd, onBack }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState("🍳");
  const [time, setTime] = useState("");
  const [servings, setServings] = useState("2");
  const [source, setSource] = useState("");
  const [tags, setTags] = useState([]);
  const [ingredients, setIngredients] = useState([{name:"",amount:""}]);
  const [steps, setSteps] = useState([""]);
  const [showTagEditor, setShowTagEditor] = useState(false);
  const [toast, setToast] = useState("");

  const inStyle = { padding:"11px 14px", borderRadius:12, border:"1.5px solid "+G.border, background:G.input, color:G.text, fontSize:14, outline:"none", boxSizing:"border-box", width:"100%", marginBottom:10 };

  const submit = () => {
    if (!title.trim()) { setToast("⚠️ 料理名を入力してください"); return; }
    onAdd({ title:title.trim(), description:description.trim(), emoji, time:time.trim()||null, servings:servings?servings+"人分":null, source:source.trim()||"自作", sourceUrl:null, tags, ingredients:ingredients.filter(i=>i.name.trim()), steps:steps.filter(s=>s.trim()), comments:[] });
  };

  return (
    <div style={{ minHeight:"100vh", background:G.dark, padding:24 }}>
      <style>{"@import url('https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@700;900&display=swap'); *, *::before, *::after { box-sizing:border-box; }"}</style>
      {showTagEditor&&<TagEditor tags={tags} onSave={t=>{setTags(t);setShowTagEditor(false);}} onClose={()=>setShowTagEditor(false)}/>}
      <div style={{ maxWidth:500, margin:"0 auto" }}>
        <button onClick={onBack} style={{ background:"none", border:"none", color:G.accent, fontSize:14, cursor:"pointer", padding:0, marginBottom:20 }}>← 戻る</button>
        <div style={{ fontFamily:"'Zen Kaku Gothic New',sans-serif", fontSize:22, fontWeight:900, color:G.text, marginBottom:20 }}>✍️ レシピを手書き</div>

        <div style={{ display:"flex", gap:10, marginBottom:0 }}>
          <div>
            <div style={{ fontSize:12, color:G.sub, marginBottom:6 }}>絵文字</div>
            <input value={emoji} onChange={e=>setEmoji(e.target.value)} style={{ ...inStyle, width:60, textAlign:"center", fontSize:24, padding:"8px" }}/>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:12, color:G.sub, marginBottom:6 }}>料理名 *</div>
            <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="例：唐揚げ" style={inStyle}/>
          </div>
        </div>
        <div style={{ fontSize:12, color:G.sub, marginBottom:6 }}>一言説明</div>
        <input value={description} onChange={e=>setDescription(e.target.value)} placeholder="例：サクサクジューシー！" style={inStyle}/>
        <div style={{ display:"flex", gap:10 }}>
          <div style={{ flex:1 }}><div style={{ fontSize:12, color:G.sub, marginBottom:6 }}>⏱ 調理時間</div><input value={time} onChange={e=>setTime(e.target.value)} placeholder="30分" style={inStyle}/></div>
          <div style={{ flex:1 }}><div style={{ fontSize:12, color:G.sub, marginBottom:6 }}>👥 人数</div><input value={servings} onChange={e=>setServings(e.target.value)} placeholder="2" type="number" min="1" style={inStyle}/></div>
        </div>
        <div style={{ fontSize:12, color:G.sub, marginBottom:6 }}>📌 出典・SNS</div>
        <input value={source} onChange={e=>setSource(e.target.value)} placeholder="例：自作 / Instagram" style={inStyle}/>

        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:12, color:G.sub, marginBottom:8 }}>🏷 タグ</div>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
            {tags.map((t,i)=><Tag key={i} label={t} active onRemove={()=>setTags(tags.filter((_,idx)=>idx!==i))}/>)}
            <button onClick={()=>setShowTagEditor(true)} style={{ background:G.accent+"22", border:"1.5px dashed "+G.accent+"88", borderRadius:20, padding:"3px 10px", color:G.accent, fontSize:11, fontWeight:700, cursor:"pointer" }}>＋ タグを追加</button>
          </div>
        </div>

        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:12, color:G.sub, marginBottom:8 }}>🥘 材料</div>
          {ingredients.map((ing,i)=>(
            <div key={i} style={{ display:"flex", gap:8, marginBottom:8 }}>
              <input value={ing.name} onChange={e=>{const a=[...ingredients];a[i]={...a[i],name:e.target.value};setIngredients(a);}} placeholder="材料名" style={{ flex:2, padding:"9px 12px", borderRadius:10, border:"1.5px solid "+G.border, background:G.input, color:G.text, fontSize:13, outline:"none" }}/>
              <input value={ing.amount} onChange={e=>{const a=[...ingredients];a[i]={...a[i],amount:e.target.value};setIngredients(a);}} placeholder="分量" style={{ flex:1, padding:"9px 12px", borderRadius:10, border:"1.5px solid "+G.border, background:G.input, color:G.text, fontSize:13, outline:"none" }}/>
              <button onClick={()=>setIngredients(ingredients.filter((_,idx)=>idx!==i))} style={{ background:G.input, border:"none", borderRadius:8, width:34, color:G.sub, cursor:"pointer", fontSize:14, flexShrink:0 }}>✕</button>
            </div>
          ))}
          <button onClick={()=>setIngredients([...ingredients,{name:"",amount:""}])} style={{ width:"100%", padding:9, borderRadius:10, border:"1.5px dashed "+G.border, background:G.input, color:G.sub, fontSize:13, cursor:"pointer" }}>＋ 材料を追加</button>
        </div>

        <div style={{ marginBottom:24 }}>
          <div style={{ fontSize:12, color:G.sub, marginBottom:8 }}>👨‍🍳 作り方</div>
          {steps.map((step,i)=>(
            <div key={i} style={{ display:"flex", gap:8, marginBottom:8, alignItems:"flex-start" }}>
              <div style={{ background:"linear-gradient(135deg,#5ac87a,#3aa85a)", color:"#fff", borderRadius:"50%", minWidth:26, height:26, marginTop:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700 }}>{i+1}</div>
              <textarea value={step} onChange={e=>{const a=[...steps];a[i]=e.target.value;setSteps(a);}} placeholder={"手順 "+(i+1)} rows={2} style={{ flex:1, padding:"9px 12px", borderRadius:10, border:"1.5px solid "+G.border, background:G.input, color:G.text, fontSize:13, outline:"none", resize:"vertical" }}/>
              <button onClick={()=>setSteps(steps.filter((_,idx)=>idx!==i))} style={{ background:G.input, border:"none", borderRadius:8, width:34, height:34, marginTop:4, color:G.sub, cursor:"pointer", fontSize:14, flexShrink:0 }}>✕</button>
            </div>
          ))}
          <button onClick={()=>setSteps([...steps,""])} style={{ width:"100%", padding:9, borderRadius:10, border:"1.5px dashed "+G.border, background:G.input, color:G.sub, fontSize:13, cursor:"pointer" }}>＋ 手順を追加</button>
        </div>

        <button onClick={submit} style={{ width:"100%", padding:"15px", borderRadius:14, border:"none", background:title.trim()?"linear-gradient(135deg,#e8825a,#c8603a)":G.input, color:G.text, fontSize:15, fontWeight:700, cursor:title.trim()?"pointer":"default", boxShadow:title.trim()?"0 4px 16px #e8825a44":"none" }}>🍳 レシピを保存</button>
      </div>
      <Toast msg={toast} onClear={()=>setToast("")}/>
    </div>
  );
}

function AddScreen({ onBack, onAdd, userName }) {
  const [mode, setMode] = useState("image");
  const [textInput, setTextInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [toast, setToast] = useState("");
  const fileRef = useRef();

  if (mode==="manual") return <ManualForm onAdd={r=>{onAdd({...r,addedBy:userName,addedAt:new Date().toLocaleDateString("ja-JP")});}} onBack={()=>setMode("image")}/>;

  const process = async ({imageFile, text}) => {
    setLoading(true);
    setLoadingMsg(imageFile?"🤖 解析中...":"🔍 取得中...");
    try {
      const data = await extractRecipe({imageFile,text});
      onAdd({...data,id:Date.now(),addedBy:userName,addedAt:new Date().toLocaleDateString("ja-JP"),comments:[],sourceUrl:data.sourceUrl||(typeof text==="string"&&text.startsWith("http")?text:null)});
    } catch(e) { setLoading(false); setToast("❌ "+e.message); }
  };

  return (
    <div style={{ minHeight:"100vh", background:G.dark, padding:24 }}>
      <style>{"@import url('https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@700;900&display=swap'); *, *::before, *::after { box-sizing:border-box; }"}</style>
      <div style={{ maxWidth:500, margin:"0 auto" }}>
        <button onClick={onBack} style={{ background:"none", border:"none", color:G.accent, fontSize:14, cursor:"pointer", padding:0, marginBottom:22 }}>← 戻る</button>
        <div style={{ fontFamily:"'Zen Kaku Gothic New',sans-serif", fontSize:22, fontWeight:900, color:G.text, marginBottom:20 }}>レシピを追加</div>
        <div style={{ display:"flex", background:G.card, borderRadius:14, padding:4, marginBottom:22, gap:3, border:"1.5px solid "+G.border }}>
          {[{id:"image",label:"📸 スクショ"},{id:"text",label:"🔗 URL"},{id:"manual",label:"✍️ 手書き"}].map(m=>(
            <button key={m.id} onClick={()=>setMode(m.id)} style={{ flex:1, padding:"10px 6px", borderRadius:11, border:"none", background:mode===m.id?"linear-gradient(135deg,#e8825a,#c8603a)":"transparent", color:mode===m.id?"#fff":G.sub, fontWeight:mode===m.id?700:400, cursor:"pointer", fontSize:12 }}>{m.label}</button>
          ))}
        </div>
        {mode==="image"&&(
          <div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }} onChange={e=>{const f=e.target.files?.[0];if(f)process({imageFile:f});e.target.value="";}}/>
            <div onClick={()=>!loading&&fileRef.current?.click()} style={{ border:"2.5px dashed "+G.accent+"66", borderRadius:20, padding:"44px 24px", textAlign:"center", cursor:loading?"default":"pointer", background:"linear-gradient(135deg,#1e1a2e,#1a1e2e)" }}>
              {loading?<Loader msg={loadingMsg}/>:(
                <div>
                  <div style={{ fontSize:52, marginBottom:14 }}>📱</div>
                  <div style={{ color:G.text, fontWeight:700, marginBottom:6, fontSize:15 }}>レシピ画像をアップロード</div>
                  <div style={{ color:G.sub, fontSize:13, lineHeight:1.8 }}>SNSのスクショや料理写真をタップ</div>
                  <div style={{ marginTop:18, display:"inline-flex", background:"linear-gradient(135deg,#e8825a,#c8603a)", color:"#fff", borderRadius:12, padding:"10px 24px", fontSize:13, fontWeight:700, boxShadow:"0 4px 16px #e8825a44" }}>📂 ファイルを選択</div>
                </div>
              )}
            </div>
          </div>
        )}
        {mode==="text"&&(
          <div>
            <textarea value={textInput} onChange={e=>setTextInput(e.target.value)} placeholder={"URLやSNS投稿テキストを貼り付け\n\n例: https://cookpad.com/recipe/..."} rows={7} style={{ width:"100%", padding:"14px 16px", borderRadius:14, border:"2px solid "+G.border, background:G.card, color:G.text, fontSize:14, outline:"none", resize:"vertical", boxSizing:"border-box", lineHeight:1.6 }}/>
            <button onClick={()=>process({text:textInput})} disabled={loading||!textInput.trim()} style={{ width:"100%", marginTop:12, padding:"14px", borderRadius:14, border:"none", background:loading||!textInput.trim()?G.input:"linear-gradient(135deg,#e8825a,#c8603a)", color:G.text, fontSize:15, fontWeight:700, cursor:loading||!textInput.trim()?"default":"pointer" }}>{loading?<Loader msg={loadingMsg}/>:"🤖 AIでレシピを抽出"}</button>
          </div>
        )}
      </div>
      <Toast msg={toast} onClear={()=>setToast("")}/>
    </div>
  );
}

export default function App() {
  const [userName, setUserName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [recipes, setRecipes] = useState([]);
  const [view, setView] = useState("home");
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState("");
  const [toast, setToast] = useState("");

  const GLOBAL_STYLE = "*, *::before, *::after { box-sizing:border-box; margin:0; padding:0; } body { background:"+G.dark+"; } @import url('https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@700;900&display=swap');";

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setRecipes(JSON.parse(saved));
      const n = localStorage.getItem("rs-name");
      if (n) setUserName(n);
    } catch {}
  }, []);

  const persist = (updated) => { setRecipes(updated); try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {} };
  const handleAdd = (recipe) => { persist([{...recipe,id:recipe.id||Date.now(),addedBy:recipe.addedBy||userName,addedAt:recipe.addedAt||new Date().toLocaleDateString("ja-JP")},...recipes]); setToast("✅ 追加しました！"); setView("home"); };
  const handleDelete = (id) => { persist(recipes.filter(r=>r.id!==id)); setToast("🗑 削除しました"); };
  const handleUpdate = (updated) => { const l=recipes.map(r=>r.id===updated.id?updated:r); persist(l); setSelected(updated); };

  const allTags = [...new Set(recipes.flatMap(r=>r.tags||[]))];
  const filtered = recipes.filter(r=>{
    const ms=!search||r.title?.includes(search)||(r.tags||[]).some(t=>t.includes(search));
    const mt=!activeTag||(r.tags||[]).includes(activeTag);
    return ms&&mt;
  });

  if (!userName) return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,"+G.dark+" 0%,#1a1a2e 50%,#1e1a2e 100%)", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <style>{GLOBAL_STYLE}</style>
      <div style={{ maxWidth:360, width:"100%", textAlign:"center" }}>
        <div style={{ fontSize:72, marginBottom:8 }}>🍳</div>
        <div style={{ fontFamily:"'Zen Kaku Gothic New',sans-serif", fontSize:28, fontWeight:900, marginBottom:6, background:"linear-gradient(135deg,#e8825a,#c85a8a)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>レシピノート</div>
        <div style={{ color:G.sub, fontSize:13, marginBottom:32, lineHeight:1.9 }}>SNS・スクショからレシピをまとめて<br/>管理できるツール</div>
        <input value={nameInput} onChange={e=>setNameInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&nameInput.trim()){localStorage.setItem("rs-name",nameInput.trim());setUserName(nameInput.trim());}}} placeholder="あなたの名前を入力" style={{ width:"100%", padding:"15px 16px", borderRadius:14, border:"2px solid "+G.border, background:G.card, color:G.text, fontSize:15, outline:"none", marginBottom:12 }}/>
        <button onClick={()=>{if(nameInput.trim()){localStorage.setItem("rs-name",nameInput.trim());setUserName(nameInput.trim());}}} style={{ width:"100%", padding:"15px", borderRadius:14, border:"none", background:nameInput.trim()?"linear-gradient(135deg,#e8825a,#c8603a)":G.input, color:G.text, fontSize:15, fontWeight:700, cursor:nameInput.trim()?"pointer":"default", boxShadow:nameInput.trim()?"0 6px 20px #e8825a44":"none" }}>はじめる →</button>
      </div>
    </div>
  );

  if (view==="add") return <AddScreen onBack={()=>setView("home")} onAdd={handleAdd} userName={userName}/>;

  return (
    <div style={{ minHeight:"100vh", background:G.dark }}>
      <style>{GLOBAL_STYLE}</style>
      <div style={{ background:"linear-gradient(135deg,#13132a,#1e1a2e)", borderBottom:"2px solid "+G.accent+"44", padding:"16px 20px 18px", position:"sticky", top:0, zIndex:100 }}>
        <div style={{ maxWidth:740, margin:"0 auto" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <div>
              <div style={{ fontFamily:"'Zen Kaku Gothic New',sans-serif", fontSize:20, fontWeight:900, letterSpacing:1, background:"linear-gradient(135deg,#e8825a,#c85a8a)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>🍳 レシピノート</div>
              <div style={{ color:G.sub, fontSize:11, marginTop:1 }}>{userName} • {recipes.length}品</div>
            </div>
            <button onClick={()=>setView("add")} style={{ background:"linear-gradient(135deg,#e8825a,#c8603a)", border:"none", borderRadius:14, padding:"10px 18px", color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer", boxShadow:"0 4px 18px #e8825a44" }}>＋ 追加</button>
          </div>
          <div style={{ position:"relative", marginBottom:allTags.length>0?10:0 }}>
            <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:13, color:G.sub }}>🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="レシピ名・タグで検索" style={{ width:"100%", padding:"10px 14px 10px 34px", borderRadius:12, border:"1.5px solid "+G.border, background:G.card, color:G.text, fontSize:13, outline:"none" }}/>
          </div>
          {allTags.length>0&&(
            <div style={{ display:"flex", gap:5, overflowX:"auto", paddingBottom:2 }}>
              <button onClick={()=>setActiveTag("")} style={{ background:!activeTag?"linear-gradient(135deg,#e8825a,#c8603a)":G.card, color:!activeTag?"#fff":G.sub, border:"1.5px solid "+(!activeTag?G.accent:G.border), borderRadius:20, padding:"4px 12px", fontSize:11, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0 }}>すべて</button>
              {allTags.map((t,i)=>{const c=tagColor(t);return <button key={i} onClick={()=>setActiveTag(activeTag===t?"":t)} style={{ background:activeTag===t?c+"33":G.card, color:activeTag===t?c:G.sub, border:"1.5px solid "+(activeTag===t?c:G.border), borderRadius:20, padding:"4px 12px", fontSize:11, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0, transition:"all 0.15s" }}>{t}</button>;})}
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth:740, margin:"0 auto", padding:"20px 16px 60px" }}>
        {filtered.length===0?(
          <div style={{ textAlign:"center", padding:"72px 0" }}>
            <div style={{ fontSize:56, marginBottom:16 }}>📭</div>
            <div style={{ fontWeight:700, marginBottom:8, color:G.sub }}>{search||activeTag?"該当するレシピがありません":"まだレシピがありません"}</div>
            <div style={{ fontSize:13, lineHeight:1.9, color:"#555" }}>「＋ 追加」からスクショ・URL・手書きで取り込もう</div>
          </div>
        ):(
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(185px,1fr))", gap:14 }}>
            {filtered.map(r=><RecipeCard key={r.id} recipe={r} onClick={()=>{setSelected(r);setView("detail");}} onDelete={handleDelete}/>)}
          </div>
        )}
      </div>

      {view==="detail"&&selected&&<RecipeDetail recipe={selected} onClose={()=>{setView("home");setSelected(null);}} onUpdate={handleUpdate} userName={userName}/>}
      <Toast msg={toast} onClear={()=>setToast("")}/>
    </div>
  );
}
