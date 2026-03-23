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
                        background:"linear-gradient(135deg,#e8825a,#c8603a)", color:"#fff",
                        borderRadius:"50%", minWidth:26, height:26,
                        display:"flex", alignItems:"center", justifyContent:"center",
                        fontSize:12, fontWeight:700, marginTop:2,
                      }}>{i+1}</div>
                      <div style={{ fontSize:13, color:"#c8c0d8", lineHeight:1.75 }}>{step}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {tab==="comments" && (
            <div>
              {(recipe.comments||[]).length === 0 ? (
                <div style={{ textAlign:"center", padding:"30px 0", color:"#444" }}>
                  <div style={{ fontSize:38, marginBottom:10 }}>📷</div>
                  <div style={{ fontSize:13, lineHeight:1.9 }}>まだ記録がありません</div>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:20 }}>
                  {(recipe.comments||[]).map(c => (
                    <div key={c.id} style={{
                      background:"#1a1a2a", borderRadius:14, padding:"12px 14px", border:"1px solid #25253a",
                    }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:9 }}>
                        <div style={{
                          width:28, height:28, borderRadius:"50%", flexShrink:0,
                          background:"linear-gradient(135deg,#e8825a,#8a5ac8)",
                          display:"flex", alignItems:"center", justifyContent:"center",
                          fontSize:12, fontWeight:700, color:"#fff",
                        }}>{(c.author||"?")[0].toUpperCase()}</div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:12, fontWeight:700, color:"#d0c8e0" }}>{c.author}</div>
                          <div style={{ fontSize:10, color:"#3a3a50" }}>{c.createdAt}</div>
                        </div>
                        {c.author === userName && (
                          <button onClick={() => deleteComment(c.id)} style={{
                            background:"none", border:"none", color:"#444", cursor:"pointer", fontSize:13,
                          }}>✕</button>
                        )}
                      </div>
                      {c.photo && (
                        <img src={c.photo} alt="投稿写真" style={{
                          width:"100%", borderRadius:10, marginBottom: c.text ? 9 : 0,
                          maxHeight:240, objectFit:"cover",
                        }}/>
                      )}
                      {c.text && <div style={{ fontSize:13, color:"#c0b8d0", lineHeight:1.75 }}>{c.text}</div>}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ background:"#1e1e2e", borderRadius:16, padding:"14px", border:"1px solid #25253a" }}>
                <div style={{ fontSize:12, fontWeight:700, color:"#e8825a", marginBottom:10 }}>▸ 記録を追加</div>
                <textarea
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  placeholder="感想・アレンジ・メモなど..."
                  rows={3}
                  style={{
                    width:"100%", padding:"10px 12px", borderRadius:10,
                    border:"1px solid #2a2a40", background:"#0f0f1a", color:"#d0c8e0",
                    fontSize:13, outline:"none", resize:"none",
                    boxSizing:"border-box", lineHeight:1.6, marginBottom:10,
                  }}
                />
                {photoLoading && (
                  <div style={{ color:"#e8825a", fontSize:12, marginBottom:8, textAlign:"center" }}>
                    写真を読み込み中...
                  </div>
                )}
                {commentPhoto && !photoLoading && (
                  <div style={{ position:"relative", marginBottom:10 }}>
                    <img src={commentPhoto} alt="preview" style={{
                      width:"100%", borderRadius:10, maxHeight:180, objectFit:"cover",
                    }}/>
                    <button onClick={() => setCommentPhoto(null)} style={{
                      position:"absolute", top:7, right:7, background:"#000b",
                      border:"none", borderRadius:"50%", width:28, height:28,
                      cursor:"pointer", color:"#fff", fontSize:14,
                    }}>✕</button>
                  </div>
                )}
                <input
                  ref={photoRef}
                  type="file"
                  accept="image/*"
                  style={{ display:"none" }}
                  onChange={e => { const f = e.target.files?.[0]; if(f) handlePhotoSelect(f); e.target.value=""; }}
                />
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={() => photoRef.current?.click()} disabled={photoLoading} style={{
                    padding:"9px 14px", borderRadius:10, border:"1px solid #2a2a40",
                    background:"#0f0f1a", color: photoLoading ? "#444" : "#777",
                    fontSize:12, cursor: photoLoading ? "default" : "pointer", whiteSpace:"nowrap",
                  }}>{photoLoading ? "読込中..." : "📷 写真を追加"}</button>
                  <button
                    onClick={submitComment}
                    disabled={!commentText.trim() && !commentPhoto}
                    style={{
                      flex:1, padding:"9px", borderRadius:10, border:"none",
                      background: (!commentText.trim() && !commentPhoto) ? "#25253a" : "linear-gradient(135deg,#e8825a,#c8603a)",
                      color:"#fff", fontSize:13, fontWeight:700,
                      cursor: (!commentText.trim() && !commentPhoto) ? "default" : "pointer",
                    }}
                  >投稿する</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
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

  const process = async ({ imageFile, text }) => {
    setLoading(true);
    setLoadingMsg(imageFile ? "🤖 AIがレシピを解析中..." : "🔍 AIが取得中...");
    try {
      const data = await extractRecipe({ imageFile, text });
      onAdd({
        ...data, id: Date.now(), addedBy: userName,
        addedAt: new Date().toLocaleDateString("ja-JP"),
        comments: [],
        sourceUrl: data.sourceUrl || (typeof text === "string" && text.startsWith("http") ? text : null),
      });
    } catch(e) {
      setLoading(false);
      setToast("❌ " + e.message);
    }
  };

  return (
    <div style={{ minHeight:"100vh", background:"#0f0f14", padding:24 }}>
      <style>{"@import url('https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@700;900&display=swap');"}</style>
      <div style={{ maxWidth:500, margin:"0 auto" }}>
        <button onClick={onBack} style={{
          background:"none", border:"none", color:"#e8825a",
          fontSize:14, cursor:"pointer", padding:0, marginBottom:24,
        }}>← 戻る</button>
        <div style={{
          fontFamily:"'Zen Kaku Gothic New',sans-serif",
          fontSize:22, fontWeight:900, color:"#f0eaff", marginBottom:22,
        }}>レシピを追加</div>
        <div style={{ display:"flex", background:"#1a1a2e", borderRadius:12, padding:4, marginBottom:22, border:"1px solid #25253a" }}>
          {[{id:"image",label:"📸 スクショ"},{id:"text",label:"🔗 URL・テキスト"}].map(m => (
            <button key={m.id} onClick={() => setMode(m.id)} style={{
              flex:1, padding:"10px", borderRadius:10, border:"none",
              background: mode===m.id ? "#e8825a" : "transparent",
              color: mode===m.id ? "#fff" : "#666",
              fontWeight: mode===m.id ? 700 : 400, cursor:"pointer", fontSize:13,
            }}>{m.label}</button>
          ))}
        </div>
        {mode === "image" ? (
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display:"none" }}
              onChange={e => { const f = e.target.files?.[0]; if(f) process({imageFile:f}); e.target.value=""; }}
            />
            <div
              onClick={() => !loading && fileRef.current?.click()}
              style={{
                border:"2.5px dashed #25253a", borderRadius:20, padding:"48px 24px",
                textAlign:"center", cursor: loading ? "default" : "pointer", background:"#1a1a2e",
              }}
            >
              {loading ? <Loader msg={loadingMsg}/> : (
                <div>
                  <div style={{ fontSize:52, marginBottom:16 }}>📱</div>
                  <div style={{ color:"#d0c8e0", fontWeight:700, marginBottom:8, fontSize:15 }}>レシピ画像をアップロード</div>
                  <div style={{ color:"#444", fontSize:13, lineHeight:1.8 }}>SNSのスクショや料理写真をタップして選択</div>
                  <div style={{
                    marginTop:20, display:"inline-flex",
                    background:"linear-gradient(135deg,#e8825a,#c8603a)",
                    color:"#fff", borderRadius:10, padding:"10px 22px", fontSize:13, fontWeight:700,
                  }}>📂 ファイルを選択</div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div>
            <textarea
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              placeholder={"URLやSNS投稿テキストを貼り付け\n\n例: https://cookpad.com/recipe/...\n例: 材料：卵2個..."}
              rows={7}
              style={{
                width:"100%", padding:"14px 16px", borderRadius:14,
                border:"2px solid #25253a", background:"#1a1a2e", color:"#d0c8e0",
                fontSize:14, outline:"none", resize:"vertical", boxSizing:"border-box", lineHeight:1.6,
              }}
            />
            <button
              onClick={() => process({text:textInput})}
              disabled={loading || !textInput.trim()}
              style={{
                width:"100%", marginTop:12, padding:"14px", borderRadius:14, border:"none",
                background: loading || !textInput.trim() ? "#25253a" : "linear-gradient(135deg,#e8825a,#c8603a)",
                color:"#fff", fontSize:15, fontWeight:700,
                cursor: loading || !textInput.trim() ? "default" : "pointer",
              }}
            >{loading ? <Loader msg={loadingMsg}/> : "🤖 AIでレシピを抽出"}</button>
          </div>
        )}
      </div>
      <Toast msg={toast} onClear={() => setToast("")}/>
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

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setRecipes(JSON.parse(saved));
      const savedName = localStorage.getItem("rs-name");
      if (savedName) setUserName(savedName);
    } catch {}
  }, []);

  const persist = (updated) => {
    setRecipes(updated);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
  };

  const handleAdd = (recipe) => {
    persist([recipe, ...recipes]);
    setToast("✅ レシピを追加しました！");
    setView("home");
  };

  const handleDelete = (id) => {
    persist(recipes.filter(r => r.id !== id));
    setToast("🗑 削除しました");
  };

  const handleUpdate = (updated) => {
    persist(recipes.map(r => r.id === updated.id ? updated : r));
    setSelected(updated);
  };

  const allTags = [...new Set(recipes.flatMap(r => r.tags||[]))];
  const filtered = recipes.filter(r => {
    const ms = !search || r.title?.includes(search) || (r.tags||[]).some(t => t.includes(search));
    const mt = !activeTag || (r.tags||[]).includes(activeTag);
    return ms && mt;
  });

  if (!userName) return (
    <div style={{
      minHeight:"100vh", background:"linear-gradient(160deg,#0f0f14,#1a1a2e)",
      display:"flex", alignItems:"center", justifyContent:"center", padding:24,
    }}>
      <style>{"@import url('https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@700;900&display=swap');"}</style>
      <div style={{ maxWidth:360, width:"100%", textAlign:"center" }}>
        <div style={{ fontSize:62, marginBottom:16 }}>🍳</div>
        <div style={{
          fontFamily:"'Zen Kaku Gothic New',sans-serif",
          fontSize:26, fontWeight:900, color:"#f0eaff", marginBottom:8,
        }}>レシピノート</div>
        <div style={{ color:"#555", fontSize:13, marginBottom:30, lineHeight:1.9 }}>
          SNS・スクショからレシピをまとめて管理できるツール
        </div>
        <input
          value={nameInput}
          onChange={e => setNameInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && nameInput.trim()) {
              localStorage.setItem("rs-name", nameInput.trim());
              setUserName(nameInput.trim());
            }
          }}
          placeholder="あなたの名前を入力"
          style={{
            width:"100%", padding:"14px 16px", borderRadius:14,
            border:"2px solid #25253a", background:"#1a1a2e", color:"#f0eaff",
            fontSize:15, outline:"none", boxSizing:"border-box", marginBottom:12,
          }}
        />
        <button
          onClick={() => {
            if (nameInput.trim()) {
              localStorage.setItem("rs-name", nameInput.trim());
              setUserName(nameInput.trim());
            }
          }}
          style={{
            width:"100%", padding:"14px", borderRadius:14, border:"none",
            background: nameInput.trim() ? "linear-gradient(135deg,#e8825a,#c8603a)" : "#25253a",
            color:"#fff", fontSize:15, fontWeight:700,
            cursor: nameInput.trim() ? "pointer" : "default",
          }}
        >はじめる →</button>
      </div>
    </div>
  );

  if (view === "add") return (
    <AddScreen onBack={() => setView("home")} onAdd={handleAdd} userName={userName}/>
  );

  return (
    <div style={{ minHeight:"100vh", background:"#0f0f14" }}>
      <style>{"@import url('https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@700;900&display=swap');"}</style>
      <div style={{
        background:"#13131e", borderBottom:"1px solid #1e1e2e",
        padding:"16px 20px 18px", position:"sticky", top:0, zIndex:100,
      }}>
        <div style={{ maxWidth:740, margin:"0 auto" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <div>
              <div style={{
                fontFamily:"'Zen Kaku Gothic New',sans-serif",
                fontSize:19, fontWeight:900, color:"#f0eaff", letterSpacing:1,
              }}>🍳 レシピノート</div>
              <div style={{ color:"#404055", fontSize:11, marginTop:1 }}>{userName} • {recipes.length}品</div>
            </div>
            <button onClick={() => setView("add")} style={{
              background:"linear-gradient(135deg,#e8825a,#c8603a)", border:"none",
              borderRadius:12, padding:"10px 18px", color:"#fff", fontWeight:700,
              fontSize:14, cursor:"pointer", boxShadow:"0 4px 18px #e8825a33",
            }}>＋ 追加</button>
          </div>
          <div style={{ position:"relative", marginBottom: allTags.length > 0 ? 10 : 0 }}>
            <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:13, color:"#3a3a50" }}>🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="レシピ名・タグで検索"
              style={{
                width:"100%", padding:"10px 14px 10px 34px", borderRadius:10,
                border:"1px solid #1e1e2e", background:"#1a1a28", color:"#c0c0d8",
                fontSize:13, outline:"none", boxSizing:"border-box",
              }}
            />
          </div>
          {allTags.length > 0 && (
            <div style={{ display:"flex", gap:5, overflowX:"auto", paddingBottom:2 }}>
              <button onClick={() => setActiveTag("")} style={{
                background: !activeTag ? "#e8825a" : "#1a1a28",
                color: !activeTag ? "#fff" : "#555",
                border:"none", borderRadius:20, padding:"4px 12px", fontSize:11,
                fontWeight:700, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0,
              }}>すべて</button>
              {allTags.map((t,i) => {
                const c = tagColor(t);
                return (
                  <button key={i} onClick={() => setActiveTag(activeTag === t ? "" : t)} style={{
                    background: activeTag===t ? c+"22" : "#1a1a28",
                    color: activeTag===t ? c : "#555",
                    border: "1px solid " + (activeTag===t ? c+"55" : "#25253a"),
                    borderRadius:20, padding:"4px 12px", fontSize:11, fontWeight:700,
                    cursor:"pointer", whiteSpace:"nowrap", flexShrink:0,
                  }}>{t}</button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div style={{ maxWidth:740, margin:"0 auto", padding:"20px 16px 56px" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign:"center", padding:"72px 0" }}>
            <div style={{ fontSize:52, marginBottom:16 }}>📭</div>
            <div style={{ fontWeight:700, marginBottom:8, color:"#555" }}>
              {search||activeTag ? "該当するレシピがありません" : "まだレシピがありません"}
            </div>
            <div style={{ fontSize:13, lineHeight:1.9, color:"#444" }}>
              「＋ 追加」からスクショやURLでレシピを取り込もう
            </div>
          </div>
        ) : (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(190px,1fr))", gap:14 }}>
            {filtered.map(r => (
              <RecipeCard
                key={r.id}
                recipe={r}
                onClick={() => { setSelected(r); setView("detail"); }}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
      {view === "detail" && selected && (
        <RecipeDetail
          recipe={selected}
          onClose={() => { setView("home"); setSelected(null); }}
          onUpdate={handleUpdate}
          userName={userName}
        />
      )}
      <Toast msg={toast} onClear={() => setToast("")}/>
    </div>
  );
}
