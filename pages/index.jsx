import { useState, useEffect, useRef, useMemo } from "react";

const STORAGE_KEY = "recipe-note-v2";
const HISTORY_KEY = "recipe-history";
const AUTH_KEY = "recipe-note-auth";
const APP_PASSWORD = process.env.NEXT_PUBLIC_APP_PASSWORD || "";

const G = {
  dark:"#0a0a12", card:"#13132a", input:"#1a1a30", border:"#2a2a45",
  text:"#f0eaff", sub:"#8888aa", accent:"#e8825a", accent2:"#c85a8a",
  green:"#5ac87a", blue:"#5a9ee8", yellow:"#e8c05a", purple:"#8a5ac8",
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@700;900&display=swap');
*,*::before,*::after{box-sizing:border-box!important;margin:0;padding:0}
body{background:#0a0a12;color:#f0eaff;-webkit-text-size-adjust:100%}
input,textarea,select,button{-webkit-appearance:none!important;appearance:none!important;font-family:inherit;background-clip:padding-box}
input:focus,textarea:focus,button:focus{outline:none!important;box-shadow:none!important;-webkit-tap-highlight-color:transparent!important}
input[type=file]{display:none!important}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-thumb{background:#2a2a45;border-radius:4px}
`;

const toMs=(v)=>{if(!v)return 0;const d=new Date(v);return isNaN(d)?0:d.getTime();};

function scaleAmount(str,scale){
  if(!str||scale===1)return str;
  return str.replace(/(\d+\.?\d*)/g,(m)=>{const n=parseFloat(m)*scale;return Number.isInteger(n)?String(n):n.toFixed(1);});
}
function parseJSONRobust(text){
  if(!text)return null;
  try{return JSON.parse(text.trim());}catch{}
  const s=text.replace(/^```(?:json)?\s*/m,"").replace(/\s*```\s*$/m,"").trim();
  try{return JSON.parse(s);}catch{}
  const a=text.indexOf("{"),b=text.lastIndexOf("}");
  if(a!==-1&&b>a){try{return JSON.parse(text.slice(a,b+1));}catch{}}
  return null;
}
async function readFile(file){
  return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(new Error("失敗"));r.readAsDataURL(file);});
}

async function compressForAI(file){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    const url=URL.createObjectURL(file);
    img.onload=()=>{
      URL.revokeObjectURL(url);
      const MAX=768;
      let w=img.width,h=img.height;
      if(w>MAX||h>MAX){if(w>h){h=Math.round(h*MAX/w);w=MAX;}else{w=Math.round(w*MAX/h);h=MAX;}}
      const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
      canvas.getContext("2d").drawImage(img,0,0,w,h);
      canvas.toBlob(blob=>{
        const reader=new FileReader();
        reader.onload=()=>resolve({base64:reader.result.split(",")[1],mediaType:"image/jpeg"});
        reader.onerror=()=>reject(new Error("圧縮失敗"));
        reader.readAsDataURL(blob);
      },"image/jpeg",0.7);
    };
    img.onerror=()=>reject(new Error("画像読み込み失敗"));
    img.src=url;
  });
}

async function compressAndUpload(file,pathPrefix){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    const url=URL.createObjectURL(file);
    img.onload=async()=>{
      URL.revokeObjectURL(url);
      try{
        const MAX=1200;
        let w=img.width,h=img.height;
        if(w>MAX||h>MAX){if(w>h){h=Math.round(h*MAX/w);w=MAX;}else{w=Math.round(w*MAX/h);h=MAX;}}
        const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
        canvas.getContext("2d").drawImage(img,0,0,w,h);
        canvas.toBlob(async(blob)=>{
          try{
            const reader=new FileReader();
            reader.onload=async()=>{
              const base64=reader.result.split(",")[1];
              const path=pathPrefix+"_"+Date.now()+".jpg";
              const res=await fetch("/api/upload",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({base64,mediaType:"image/jpeg",path})});
              if(!res.ok)throw new Error("アップロード失敗");
              const data=await res.json();resolve(data.url);
            };
            reader.onerror=()=>reject(new Error("読み込み失敗"));
            reader.readAsDataURL(blob);
          }catch(e){reject(e);}
        },"image/jpeg",0.75);
      }catch(e){reject(e);}
    };
    img.onerror=()=>reject(new Error("画像読み込み失敗"));
    img.src=url;
  });
}

async function deleteStoragePhotos(paths){
  if(!paths||!paths.length)return;
  try{await fetch("/api/upload",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({paths})});}catch{}
}
function extractStoragePaths(recipe){
  const paths=[];
  if(recipe.photo&&recipe.photo.includes("supabase"))paths.push("hero/"+recipe.id);
  Object.keys(recipe.stepPhotos||{}).forEach(i=>{if(recipe.stepPhotos[i]&&recipe.stepPhotos[i].includes("supabase"))paths.push("steps/"+recipe.id+"_"+i);});
  (recipe.comments||[]).forEach(c=>{if(c.photo&&c.photo.includes("supabase"))paths.push("comments/"+c.id);});
  return paths;
}

async function extractRecipe({imageFile,text}){
  let imageBase64=null,imageMediaType=null;
  if(imageFile){
    const compressed=await compressForAI(imageFile);
    imageBase64=compressed.base64;
    imageMediaType=compressed.mediaType;
  }
  const prompt=imageFile?"この画像からレシピ情報を抽出してください。":"以下からレシピを抽出してください:\n\n"+text;
  const res=await fetch("/api/ai",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt,imageBase64,imageMediaType})});
  if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e?.error||"エラー");}
  const data=await res.json();
  const parsed=parseJSONRobust(data.content);
  if(!parsed)throw new Error("解析失敗。別の画像やURLをお試しください。");
  return parsed;
}
async function estimateNutrition(recipe){
  const prompt="以下のレシピの1人分の栄養素を推定してください。JSON形式のみで返答してください。\nフォーマット: {\"calories\":数字,\"protein\":数字,\"fat\":数字,\"carbs\":数字,\"fiber\":数字}\n単位はkcalとgです。\n\nレシピ: "+recipe.title+"\n材料: "+(recipe.ingredients||[]).map(i=>i.name+" "+i.amount).join(", ")+"\n人数: "+(recipe.servings||"2人分");
  const res=await fetch("/api/ai",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt,imageBase64:null,imageMediaType:null})});
  if(!res.ok)throw new Error("栄養素の推定に失敗しました");
  const data=await res.json();
  return parseJSONRobust(data.content);
}

function wrapText(ctx,text,maxW){
  const lines=[];let line="";
  for(const ch of(text||"")){const t=line+ch;if(ctx.measureText(t).width>maxW&&line){lines.push(line);line=ch;}else line=t;}
  if(line)lines.push(line);return lines.length?lines:[""];
}
async function exportImage(recipe){
  const W=640,pad=44;
  const ingH=(recipe.ingredients?.length||0)*28+60;
  const stepH=(recipe.steps||[]).reduce((a,s)=>a+Math.max(1,Math.ceil(s.length/30))*22+10,0)+60;
  const nutH=recipe.nutrition?120:0;
  const H=Math.min(300+ingH+stepH+nutH,2400);
  const canvas=document.createElement("canvas");canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext("2d");
  const bg=ctx.createLinearGradient(0,0,0,H);bg.addColorStop(0,"#13132a");bg.addColorStop(1,"#1e1a2e");
  ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
  const bar=ctx.createLinearGradient(0,0,W,0);bar.addColorStop(0,"#e8825a");bar.addColorStop(1,"#c85a8a");
  ctx.fillStyle=bar;ctx.fillRect(0,0,W,6);
  let y=70;
  ctx.font="54px serif";ctx.fillText(recipe.emoji||"🍽️",pad,y);
  ctx.fillStyle="#f0eaff";ctx.font="bold 26px sans-serif";
  wrapText(ctx,recipe.title,W-pad*2-70).forEach((l,i)=>ctx.fillText(l,pad+68,y-14+i*32));
  y+=Math.max(62,wrapText(ctx,recipe.title,W-pad*2-70).length*32+12);
  if(recipe.description){ctx.fillStyle="#8888aa";ctx.font="14px sans-serif";ctx.fillText(recipe.description,pad,y);y+=28;}
  ctx.font="11px sans-serif";let tx=pad;
  (recipe.tags||[]).slice(0,5).forEach(tag=>{
    const tw=ctx.measureText(tag).width+20;
    ctx.strokeStyle="#e8825a";ctx.lineWidth=1.5;ctx.fillStyle="#e8825a22";
    ctx.beginPath();ctx.roundRect(tx,y,tw,22,11);ctx.fill();ctx.stroke();
    ctx.fillStyle="#e8825a";ctx.fillText(tag,tx+10,y+15);tx+=tw+6;
  });
  if(recipe.tags?.length)y+=36;
  ctx.fillStyle="#555577";ctx.font="13px sans-serif";
  const meta=[(recipe.time&&"⏱ "+recipe.time),(recipe.servings&&"👥 "+recipe.servings)].filter(Boolean).join("  ");
  if(meta){ctx.fillText(meta,pad,y);y+=32;}
  ctx.strokeStyle="#2a2a45";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(W-pad,y);ctx.stroke();y+=24;
  if(recipe.nutrition){
    ctx.fillStyle="#e8c05a";ctx.font="bold 15px sans-serif";ctx.fillText("📊 栄養素（1人分）",pad,y);y+=26;
    const n=recipe.nutrition;
    [["カロリー",n.calories,"kcal","#e8825a"],["たんぱく質",n.protein,"g","#5a9ee8"],["脂質",n.fat,"g","#e8c05a"],["炭水化物",n.carbs,"g","#5ac87a"],["食物繊維",n.fiber,"g","#8a5ac8"]].forEach(([label,val,unit,color],idx)=>{
      const cx=pad+(idx*(W-pad*2)/5);
      ctx.fillStyle="#555577";ctx.font="13px sans-serif";ctx.fillText(label,cx,y);
      ctx.fillStyle=color;ctx.font="bold 15px sans-serif";ctx.fillText((val||0)+unit,cx,y+20);
    });
    y+=50;ctx.strokeStyle="#2a2a45";ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(W-pad,y);ctx.stroke();y+=24;
  }
  if(recipe.ingredients?.length){
    ctx.fillStyle="#e8825a";ctx.font="bold 15px sans-serif";ctx.fillText("🥘 材料",pad,y);y+=28;
    recipe.ingredients.forEach(ing=>{
      ctx.fillStyle="#d0c8e0";ctx.font="14px sans-serif";ctx.fillText("・"+ing.name,pad+8,y);
      if(ing.amount){ctx.fillStyle="#8888aa";ctx.fillText(ing.amount,W-pad-ctx.measureText(ing.amount).width,y);}
      y+=28;
    });y+=16;
  }
  if(recipe.steps?.length){
    ctx.fillStyle="#5ac87a";ctx.font="bold 15px sans-serif";ctx.fillText("👨‍🍳 作り方",pad,y);y+=28;
    recipe.steps.forEach((step,i)=>{
      ctx.fillStyle="#5ac87a";ctx.beginPath();ctx.arc(pad+12,y-5,12,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#fff";ctx.font="bold 11px sans-serif";ctx.fillText(String(i+1),pad+(i<9?9:6),y);
      ctx.fillStyle="#c8c0d8";ctx.font="13px sans-serif";
      const lines=wrapText(ctx,step,W-pad*2-32);
      lines.forEach((l,li)=>ctx.fillText(l,pad+30,y+li*22));
      y+=Math.max(lines.length*22+10,28);
    });
  }
  ctx.fillStyle="#333355";ctx.font="11px sans-serif";ctx.fillText("🍳 レシピノート",pad,Math.min(y+20,H-20));
  const link=document.createElement("a");link.download=(recipe.title||"recipe")+".png";link.href=canvas.toDataURL("image/png");link.click();
}

function encodeShareURL(recipe){
  try{const d={...recipe,comments:[],stepPhotos:{},photo:null};return window.location.origin+window.location.pathname+"?share="+btoa(unescape(encodeURIComponent(JSON.stringify(d))));}catch{return null;}
}
function parseShareParam(){
  if(typeof window==="undefined")return null;
  const p=new URLSearchParams(window.location.search);
  const s=p.get("share");if(!s)return null;
  try{return JSON.parse(decodeURIComponent(escape(atob(s))));}catch{return null;}
}
async function doSync(localRecipes,userName){
  const res=await fetch("/api/room",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({recipes:localRecipes,member:userName})});
  if(!res.ok)throw new Error("同期失敗");
  return res.json();
}
async function fetchRemote(userName){
  const res=await fetch("/api/room?member="+encodeURIComponent(userName));
  if(!res.ok)throw new Error("取得失敗");
  return res.json();
}

const DEFAULT_TAG_CATS=[
  {label:"🍱 ジャンル",tags:["和食","洋食","中華","韓国料理","イタリアン","エスニック","デザート","スープ"]},
  {label:"🥦 野菜",tags:["葉野菜","根菜","豆類","きのこ","トマト","なす","じゃがいも","玉ねぎ"]},
  {label:"🥩 食材",tags:["鶏肉","豚肉","牛肉","魚介","卵","豆腐","乳製品","パスタ","米"]},
  {label:"⏱ 手間",tags:["簡単","時短","本格","作り置き","5分","15分","30分"]},
  {label:"🍽 用途",tags:["主菜","副菜","汁物","お弁当","おつまみ","朝食","パーティー"]},
];
const TAG_CATS_KEY="recipe-tag-cats";
function loadTagCats(){
  if(typeof window==="undefined")return DEFAULT_TAG_CATS;
  try{const s=localStorage.getItem(TAG_CATS_KEY);return s?JSON.parse(s):DEFAULT_TAG_CATS;}catch{return DEFAULT_TAG_CATS;}
}
function saveTagCats(cats){try{localStorage.setItem(TAG_CATS_KEY,JSON.stringify(cats));}catch{}}

const PAL=["#e8825a","#5a9ee8","#5ac87a","#c85a8a","#c8a85a","#8a5ac8","#5ac8c8","#e8c05a"];
const tagColor=(t)=>PAL[Math.abs([...t].reduce((a,c)=>a+c.charCodeAt(0),0))%PAL.length];

function ConfirmDialog({msg,onOk,onCancel}){
  return(
    <div onClick={onCancel} style={{position:"fixed",inset:0,background:"#000c",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div onClick={e=>e.stopPropagation()} style={{background:G.card,borderRadius:20,padding:"24px 22px",maxWidth:320,width:"100%",border:"2px solid #e8825a66",boxShadow:"0 16px 48px #000a"}}>
        <div style={{fontSize:16,fontWeight:700,color:G.text,marginBottom:18,lineHeight:1.6}}>{msg}</div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={onCancel} style={{flex:1,padding:"11px",borderRadius:12,border:"1.5px solid "+G.border,background:G.input,color:G.sub,fontWeight:700,cursor:"pointer",fontSize:14}}>キャンセル</button>
          <button onClick={onOk} style={{flex:1,padding:"11px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#e85a5a,#c83a3a)",color:"#fff",fontWeight:700,cursor:"pointer",fontSize:14}}>削除する</button>
        </div>
      </div>
    </div>
  );
}
function Toast({msg,onClear}){
  useEffect(()=>{if(!msg)return;const t=setTimeout(onClear,3000);return()=>clearTimeout(t);},[msg]);
  if(!msg)return null;
  return <div style={{position:"fixed",bottom:28,left:"50%",transform:"translateX(-50%)",background:"linear-gradient(135deg,#e8825a,#c8603a)",color:"#fff",padding:"12px 26px",borderRadius:30,fontSize:14,fontWeight:700,boxShadow:"0 8px 32px #e8825a44",zIndex:9999,whiteSpace:"nowrap",maxWidth:"90vw"}}>{msg}</div>;
}
function Loader({msg}){
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:14,padding:"36px 0"}}>
      <div style={{display:"flex",gap:7}}>{[0,1,2].map(i=><div key={i} style={{width:10,height:10,borderRadius:"50%",background:G.accent,animation:"bop 1.1s ease-in-out "+(i*0.18)+"s infinite"}}/>)}</div>
      <style>{"@keyframes bop{0%,80%,100%{transform:translateY(0);opacity:.3}40%{transform:translateY(-8px);opacity:1}}"}</style>
      <div style={{color:G.accent,fontWeight:700,fontSize:13,textAlign:"center"}}>{msg}</div>
    </div>
  );
}
function Tag({label,active,onClick,onRemove}){
  const c=tagColor(label);
  return(
    <span onClick={onClick} style={{background:active?c:c+"22",color:active?"#fff":c,border:"1.5px solid "+c,borderRadius:20,padding:onRemove?"3px 6px 3px 10px":"3px 10px",fontSize:11,fontWeight:700,whiteSpace:"nowrap",cursor:onClick?"pointer":"default",display:"inline-flex",alignItems:"center",gap:4,transition:"all 0.15s"}}>
      {label}
      {onRemove&&<span onClick={e=>{e.stopPropagation();onRemove();}} style={{fontSize:10,opacity:0.8,cursor:"pointer"}}>✕</span>}
    </span>
  );
}

function TagEditor({tags,onSave,onClose}){
  const [cur,setCur]=useState([...tags]);
  const [custom,setCustom]=useState("");
  const [open,setOpen]=useState({0:true});
  const [tagCats,setTagCats]=useState(()=>loadTagCats());
  const [editingCat,setEditingCat]=useState(null);
  const [newCatTag,setNewCatTag]=useState("");
  const toggle=(t)=>setCur(p=>p.includes(t)?p.filter(x=>x!==t):[...p,t]);
  const add=()=>{if(!custom.trim()||cur.includes(custom.trim()))return;setCur(p=>[...p,custom.trim()]);setCustom("");};
  const addToCat=(ci,tag)=>{
    if(!tag.trim())return;
    const updated=tagCats.map((cat,i)=>i===ci?{...cat,tags:[...cat.tags,tag.trim()]}:cat);
    setTagCats(updated);saveTagCats(updated);setNewCatTag("");setEditingCat(null);
  };
  const removeFromCat=(ci,ti)=>{
    const updated=tagCats.map((cat,i)=>i===ci?{...cat,tags:cat.tags.filter((_,j)=>j!==ti)}:cat);
    setTagCats(updated);saveTagCats(updated);
  };
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"#000c",zIndex:2000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:G.card,borderRadius:"24px 24px 0 0",width:"100%",maxWidth:540,padding:"20px 20px 40px",maxHeight:"85vh",overflowY:"auto",border:"2px solid "+G.accent+"44"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontWeight:700,color:G.text,fontSize:16}}>🏷 タグを編集</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:G.sub,fontSize:20,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          <input value={custom} onChange={e=>setCustom(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="カスタムタグを直接追加..." style={{flex:1,padding:"9px 12px",borderRadius:10,border:"1.5px solid "+G.border,background:G.input,color:G.text,fontSize:13,WebkitAppearance:"none"}}/>
          <button onClick={add} style={{padding:"9px 16px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#e8825a,#c8603a)",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",flexShrink:0}}>追加</button>
        </div>
        {cur.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14,padding:10,background:G.input,borderRadius:12}}>{cur.map((t,i)=><Tag key={i} label={t} active onRemove={()=>toggle(t)}/>)}</div>}
        {tagCats.map((cat,ci)=>(
          <div key={ci} style={{marginBottom:8,border:"1.5px solid "+G.border,borderRadius:12,overflow:"hidden"}}>
            <button onClick={()=>setOpen(p=>({...p,[ci]:!p[ci]}))} style={{width:"100%",padding:"10px 14px",border:"none",background:open[ci]?G.input+"cc":G.input,color:G.text,fontWeight:700,fontSize:13,cursor:"pointer",display:"flex",justifyContent:"space-between"}}>
              <span>{cat.label}</span><span style={{color:G.sub}}>{open[ci]?"▲":"▼"}</span>
            </button>
            {open[ci]&&(
              <div style={{padding:"10px 12px",background:"#ffffff05"}}>
                <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:8}}>
                  {cat.tags.map((t,ti)=>(
                    <span key={ti} style={{display:"inline-flex",alignItems:"center",gap:3}}>
                      <Tag label={t} active={cur.includes(t)} onClick={()=>toggle(t)}/>
                      <span onClick={()=>removeFromCat(ci,ti)} style={{fontSize:9,color:G.sub,cursor:"pointer",padding:"0 2px"}}>✕</span>
                    </span>
                  ))}
                </div>
                {editingCat===ci?(
                  <div style={{display:"flex",gap:6}}>
                    <input value={newCatTag} onChange={e=>setNewCatTag(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")addToCat(ci,newCatTag);if(e.key==="Escape")setEditingCat(null);}} autoFocus placeholder="新しいタグ名..." style={{flex:1,padding:"6px 10px",borderRadius:8,border:"1.5px solid "+G.accent,background:G.input,color:G.text,fontSize:12,WebkitAppearance:"none"}}/>
                    <button onClick={()=>addToCat(ci,newCatTag)} style={{padding:"6px 12px",borderRadius:8,border:"none",background:G.accent,color:"#fff",fontSize:12,cursor:"pointer",fontWeight:700}}>追加</button>
                    <button onClick={()=>setEditingCat(null)} style={{padding:"6px 10px",borderRadius:8,border:"1.5px solid "+G.border,background:G.input,color:G.sub,fontSize:12,cursor:"pointer"}}>✕</button>
                  </div>
                ):(
                  <button onClick={()=>{setEditingCat(ci);setNewCatTag("");}} style={{padding:"4px 10px",borderRadius:8,border:"1.5px dashed "+G.border,background:"transparent",color:G.sub,fontSize:11,cursor:"pointer"}}>＋ このカテゴリに追加</button>
                )}
              </div>
            )}
          </div>
        ))}
        <button onClick={()=>onSave(cur)} style={{width:"100%",marginTop:14,padding:"14px",borderRadius:14,border:"none",background:"linear-gradient(135deg,#e8825a,#c8603a)",color:"#fff",fontSize:15,fontWeight:700,cursor:"pointer"}}>保存する</button>
      </div>
    </div>
  );
}

function TagManagement({recipes,onUpdateAll,onClose}){
  const [editingTag,setEditingTag]=useState(null);
  const [editValue,setEditValue]=useState("");
  const [confirmDelete,setConfirmDelete]=useState(null);
  const [toast,setToast]=useState("");
  const [tagCats,setTagCats]=useState(()=>loadTagCats());
  const [editingCat,setEditingCat]=useState(null);
  const [editCatValue,setEditCatValue]=useState("");
  const [newCatTag,setNewCatTag]=useState("");
  const [addingToCat,setAddingToCat]=useState(null);
  const [open,setOpen]=useState({});

  const activeRecipes=recipes.filter(r=>!r.deleted);
  const tagMap=useMemo(()=>{
    const map=new Map();
    activeRecipes.forEach(r=>{(r.tags||[]).forEach(t=>{map.set(t,(map.get(t)||0)+1);});});
    return new Map([...map.entries()].sort((a,b)=>b[1]-a[1]));
  },[activeRecipes]);

  const renameTag=(oldTag,newTag)=>{
    if(!newTag.trim()||newTag===oldTag)return;
    const updated=recipes.map(r=>r.deleted?r:{...r,tags:(r.tags||[]).map(t=>t===oldTag?newTag.trim():t),updatedAt:new Date().toISOString()});
    onUpdateAll(updated);setEditingTag(null);setToast("✅ タグを変更しました");
  };
  const deleteTag=(tag)=>{
    const updated=recipes.map(r=>r.deleted?r:{...r,tags:(r.tags||[]).filter(t=>t!==tag),updatedAt:new Date().toISOString()});
    onUpdateAll(updated);setConfirmDelete(null);setToast("🗑 タグを削除しました");
  };
  const saveCat=(cats)=>{setTagCats(cats);saveTagCats(cats);};
  const addTagToCat=(ci,tag)=>{
    if(!tag.trim())return;
    const updated=tagCats.map((cat,i)=>i===ci?{...cat,tags:[...cat.tags,tag.trim()]}:cat);
    saveCat(updated);setNewCatTag("");setAddingToCat(null);
  };
  const removeTagFromCat=(ci,ti)=>{
    const updated=tagCats.map((cat,i)=>i===ci?{...cat,tags:cat.tags.filter((_,j)=>j!==ti)}:cat);
    saveCat(updated);
  };
  const renameCat=(ci,label)=>{
    if(!label.trim())return;
    const updated=tagCats.map((cat,i)=>i===ci?{...cat,label:label.trim()}:cat);
    saveCat(updated);setEditingCat(null);
  };
  const addNewCat=()=>{saveCat([...tagCats,{label:"🆕 新カテゴリ",tags:[]}]);};
  const deleteCat=(ci)=>{saveCat(tagCats.filter((_,i)=>i!==ci));};

  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"#000c",zIndex:1500,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      {confirmDelete&&<ConfirmDialog msg={"「"+confirmDelete+"」を全レシピから削除しますか？"} onOk={()=>deleteTag(confirmDelete)} onCancel={()=>setConfirmDelete(null)}/>}
      <div onClick={e=>e.stopPropagation()} style={{background:G.card,borderRadius:"24px 24px 0 0",width:"100%",maxWidth:540,padding:"20px 20px 44px",maxHeight:"90vh",overflowY:"auto",border:"2px solid "+G.accent+"44"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div style={{fontWeight:700,color:G.text,fontSize:17}}>🏷 タグ管理</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:G.sub,fontSize:20,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{fontSize:12,color:G.sub,marginBottom:16}}>使用中のタグ一覧・カテゴリの編集ができます</div>
        <div style={{background:G.input,borderRadius:14,padding:14,marginBottom:16,border:"1.5px solid "+G.border}}>
          <div style={{fontWeight:700,color:G.text,fontSize:13,marginBottom:10}}>📊 使用中のタグ（{tagMap.size}種）</div>
          {tagMap.size===0?(
            <div style={{textAlign:"center",color:G.sub,fontSize:12,padding:"8px 0"}}>タグがありません</div>
          ):(
            [...tagMap.entries()].map(([tag,count])=>(
              <div key={tag} style={{marginBottom:6}}>
                {editingTag===tag?(
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <input value={editValue} onChange={e=>setEditValue(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")renameTag(tag,editValue);if(e.key==="Escape")setEditingTag(null);}} autoFocus style={{flex:1,padding:"7px 10px",borderRadius:8,border:"1.5px solid "+G.accent,background:G.dark,color:G.text,fontSize:13,WebkitAppearance:"none"}}/>
                    <button onClick={()=>renameTag(tag,editValue)} style={{padding:"7px 12px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#e8825a,#c8603a)",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>変更</button>
                    <button onClick={()=>setEditingTag(null)} style={{padding:"7px 10px",borderRadius:8,border:"1.5px solid "+G.border,background:G.dark,color:G.sub,fontSize:12,cursor:"pointer"}}>✕</button>
                  </div>
                ):(
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{flex:1,display:"flex",alignItems:"center",gap:8}}><Tag label={tag}/><span style={{fontSize:10,color:G.sub}}>{count}品</span></div>
                    <button onClick={()=>{setEditingTag(tag);setEditValue(tag);}} style={{padding:"4px 10px",borderRadius:7,border:"1.5px solid "+G.border,background:G.dark,color:G.sub,fontSize:11,cursor:"pointer"}}>編集</button>
                    <button onClick={()=>setConfirmDelete(tag)} style={{padding:"4px 10px",borderRadius:7,border:"none",background:"#e85a5a22",color:"#e85a5a",fontSize:11,cursor:"pointer",fontWeight:700}}>削除</button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        <div style={{fontWeight:700,color:G.text,fontSize:13,marginBottom:10}}>📂 カテゴリ管理</div>
        {tagCats.map((cat,ci)=>(
          <div key={ci} style={{marginBottom:8,border:"1.5px solid "+G.border,borderRadius:12,overflow:"hidden"}}>
            <div style={{display:"flex",alignItems:"center",background:G.input}}>
              <button onClick={()=>setOpen(p=>({...p,[ci]:!p[ci]}))} style={{flex:1,padding:"10px 14px",border:"none",background:"transparent",color:G.text,fontWeight:700,fontSize:13,cursor:"pointer",textAlign:"left"}}>
                {editingCat===ci?(
                  <input value={editCatValue} onChange={e=>setEditCatValue(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")renameCat(ci,editCatValue);if(e.key==="Escape")setEditingCat(null);}} onClick={e=>e.stopPropagation()} autoFocus style={{padding:"3px 8px",borderRadius:6,border:"1.5px solid "+G.accent,background:G.dark,color:G.text,fontSize:13,WebkitAppearance:"none",width:"80%"}}/>
                ):cat.label}
              </button>
              <div style={{display:"flex",gap:4,padding:"0 10px"}}>
                {editingCat===ci?(
                  <>
                    <button onClick={()=>renameCat(ci,editCatValue)} style={{padding:"4px 8px",borderRadius:6,border:"none",background:G.accent,color:"#fff",fontSize:11,cursor:"pointer"}}>保存</button>
                    <button onClick={()=>setEditingCat(null)} style={{padding:"4px 8px",borderRadius:6,border:"1.5px solid "+G.border,background:G.dark,color:G.sub,fontSize:11,cursor:"pointer"}}>✕</button>
                  </>
                ):(
                  <>
                    <button onClick={()=>{setEditingCat(ci);setEditCatValue(cat.label);}} style={{padding:"4px 8px",borderRadius:6,border:"1.5px solid "+G.border,background:G.dark,color:G.sub,fontSize:11,cursor:"pointer"}}>✏️</button>
                    <button onClick={()=>deleteCat(ci)} style={{padding:"4px 8px",borderRadius:6,border:"none",background:"#e85a5a22",color:"#e85a5a",fontSize:11,cursor:"pointer"}}>🗑</button>
                  </>
                )}
                <span style={{color:G.sub,fontSize:13,padding:"4px 2px"}}>{open[ci]?"▲":"▼"}</span>
              </div>
            </div>
            {open[ci]&&(
              <div style={{padding:"10px 12px",background:"#ffffff05"}}>
                <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:8}}>
                  {cat.tags.map((t,ti)=>(
                    <span key={ti} style={{display:"inline-flex",alignItems:"center",gap:3,background:tagColor(t)+"22",border:"1.5px solid "+tagColor(t),borderRadius:20,padding:"3px 6px 3px 10px"}}>
                      <span style={{fontSize:11,fontWeight:700,color:tagColor(t)}}>{t}</span>
                      <span onClick={()=>removeTagFromCat(ci,ti)} style={{fontSize:10,color:G.sub,cursor:"pointer",padding:"0 2px"}}>✕</span>
                    </span>
                  ))}
                </div>
                {addingToCat===ci?(
                  <div style={{display:"flex",gap:6}}>
                    <input value={newCatTag} onChange={e=>setNewCatTag(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")addTagToCat(ci,newCatTag);if(e.key==="Escape")setAddingToCat(null);}} autoFocus placeholder="新しいタグ名..." style={{flex:1,padding:"6px 10px",borderRadius:8,border:"1.5px solid "+G.accent,background:G.dark,color:G.text,fontSize:12,WebkitAppearance:"none"}}/>
                    <button onClick={()=>addTagToCat(ci,newCatTag)} style={{padding:"6px 12px",borderRadius:8,border:"none",background:G.accent,color:"#fff",fontSize:12,cursor:"pointer",fontWeight:700}}>追加</button>
                    <button onClick={()=>setAddingToCat(null)} style={{padding:"6px 10px",borderRadius:8,border:"1.5px solid "+G.border,background:G.dark,color:G.sub,fontSize:12,cursor:"pointer"}}>✕</button>
                  </div>
                ):(
                  <button onClick={()=>{setAddingToCat(ci);setNewCatTag("");}} style={{padding:"5px 12px",borderRadius:8,border:"1.5px dashed "+G.border,background:"transparent",color:G.sub,fontSize:11,cursor:"pointer"}}>＋ タグを追加</button>
                )}
              </div>
            )}
          </div>
        ))}
        <button onClick={addNewCat} style={{width:"100%",padding:"10px",borderRadius:12,border:"1.5px dashed "+G.blue+"66",background:G.blue+"11",color:G.blue,fontSize:13,fontWeight:700,cursor:"pointer",marginTop:4}}>＋ 新しいカテゴリを追加</button>
        {toast&&<div style={{marginTop:14,padding:"10px 14px",borderRadius:12,background:G.accent+"22",color:G.accent,fontSize:13,fontWeight:700,textAlign:"center"}}>{toast}</div>}
      </div>
    </div>
  );
}

function ShoppingList({recipe,onClose}){
  const [checked,setChecked]=useState({});
  const [copied,setCopied]=useState(false);
  const toggle=(i)=>setChecked(p=>({...p,[i]:!p[i]}));
  const uncheckedText=(recipe.ingredients||[]).filter((_,i)=>!checked[i]).map(ing=>ing.name+(ing.amount?" "+ing.amount:"")).join("\n");
  const allText=(recipe.ingredients||[]).map(ing=>ing.name+(ing.amount?" "+ing.amount:"")).join("\n");
  const copy=()=>{navigator.clipboard?.writeText(uncheckedText||allText);setCopied(true);setTimeout(()=>setCopied(false),2000);};
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"#000c",zIndex:2000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:G.card,borderRadius:"24px 24px 0 0",width:"100%",maxWidth:540,padding:"20px 20px 40px",maxHeight:"80vh",overflowY:"auto",border:"2px solid "+G.green+"44"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div style={{fontWeight:700,color:G.text,fontSize:16}}>🛒 買い物リスト</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:G.sub,fontSize:20,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{fontSize:12,color:G.sub,marginBottom:16}}>{recipe.title}</div>
        <div style={{marginBottom:16}}>
          {(recipe.ingredients||[]).map((ing,i)=>(
            <div key={i} onClick={()=>toggle(i)} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",borderRadius:12,marginBottom:6,background:checked[i]?G.input+"88":G.input,border:"1.5px solid "+(checked[i]?G.border+"44":G.border),cursor:"pointer",transition:"all 0.15s"}}>
              <div style={{width:22,height:22,borderRadius:"50%",border:"2px solid "+(checked[i]?G.green:G.border),background:checked[i]?"linear-gradient(135deg,#5ac87a,#3aa85a)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.15s"}}>
                {checked[i]&&<span style={{color:"#fff",fontSize:12}}>✓</span>}
              </div>
              <div style={{flex:1}}>
                <span style={{fontSize:14,color:checked[i]?G.sub:G.text,textDecoration:checked[i]?"line-through":"none",transition:"all 0.15s"}}>{ing.name}</span>
                {ing.amount&&<span style={{fontSize:12,color:G.sub,marginLeft:8}}>{ing.amount}</span>}
              </div>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={()=>setChecked({})} style={{flex:1,padding:"12px",borderRadius:12,border:"1.5px solid "+G.border,background:G.input,color:G.sub,fontWeight:700,cursor:"pointer",fontSize:13}}>リセット</button>
          <button onClick={copy} style={{flex:2,padding:"12px",borderRadius:12,border:"none",background:copied?"linear-gradient(135deg,#5ac87a,#3aa85a)":"linear-gradient(135deg,#5a9ee8,#3a7ec8)",color:"#fff",fontWeight:700,cursor:"pointer",fontSize:13}}>{copied?"✅ コピーしました":"📋 未チェックをコピー"}</button>
        </div>
      </div>
    </div>
  );
}

function ShareModal({recipe,onClose}){
  const [copied,setCopied]=useState(false);
  const url=encodeShareURL(recipe);
  const copy=()=>{navigator.clipboard?.writeText(url);setCopied(true);setTimeout(()=>setCopied(false),2000);};
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"#000c",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div onClick={e=>e.stopPropagation()} style={{background:G.card,borderRadius:20,padding:"22px",maxWidth:400,width:"100%",border:"2px solid "+G.accent+"44"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontWeight:700,color:G.text,fontSize:16}}>🔗 レシピを共有</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:G.sub,fontSize:20,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{fontSize:13,color:G.sub,marginBottom:10}}>URLを共有するとレシピを見てもらえます</div>
        <div style={{background:G.input,borderRadius:10,padding:"10px 12px",fontSize:11,color:G.sub,wordBreak:"break-all",marginBottom:14,lineHeight:1.6,maxHeight:72,overflow:"hidden"}}>{url}</div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={copy} style={{flex:1,padding:"12px",borderRadius:12,border:"none",background:copied?"linear-gradient(135deg,#5ac87a,#3aa85a)":"linear-gradient(135deg,#e8825a,#c8603a)",color:"#fff",fontWeight:700,cursor:"pointer",fontSize:14}}>{copied?"✅ コピー済み":"📋 URLをコピー"}</button>
          <button onClick={()=>exportImage(recipe)} style={{flex:1,padding:"12px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#8a5ac8,#6a3aa8)",color:"#fff",fontWeight:700,cursor:"pointer",fontSize:14}}>🖼 画像保存</button>
        </div>
      </div>
    </div>
  );
}
function ImportBanner({recipe,onImport,onDismiss}){
  return(
    <div style={{position:"fixed",top:0,left:0,right:0,background:"linear-gradient(135deg,#1e1a2e,#13132a)",borderBottom:"2px solid "+G.accent,padding:"14px 18px",zIndex:500,display:"flex",alignItems:"center",gap:10}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,fontWeight:700,color:G.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{"📥 "+recipe.title}</div>
        <div style={{fontSize:11,color:G.sub,marginTop:2}}>コレクションに追加しますか？</div>
      </div>
      <button onClick={onImport} style={{padding:"8px 14px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#e8825a,#c8603a)",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",flexShrink:0}}>追加</button>
      <button onClick={onDismiss} style={{padding:"8px",borderRadius:10,border:"none",background:G.input,color:G.sub,cursor:"pointer",fontSize:16,flexShrink:0}}>✕</button>
    </div>
  );
}
function NutritionPanel({recipe,onUpdate}){
  const [loading,setLoading]=useState(false);
  const estimate=async()=>{setLoading(true);try{const n=await estimateNutrition(recipe);onUpdate({...recipe,nutrition:n,updatedAt:new Date().toISOString()});}catch(e){alert(e.message);}finally{setLoading(false);}};
  if(!recipe.ingredients?.length)return null;
  if(loading)return <div style={{padding:"12px 0"}}><Loader msg="栄養素を推定中..."/></div>;
  if(!recipe.nutrition)return(
    <button onClick={estimate} style={{width:"100%",padding:"10px",borderRadius:12,border:"1.5px dashed "+G.yellow+"66",background:G.yellow+"11",color:G.yellow,fontSize:13,fontWeight:700,cursor:"pointer",marginBottom:14}}>📊 栄養素を推定する（AI）</button>
  );
  const n=recipe.nutrition;
  return(
    <div style={{background:G.card,borderRadius:14,padding:"14px",marginBottom:16,border:"1.5px solid "+G.yellow+"44"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div style={{fontWeight:700,color:G.yellow,fontSize:13}}>📊 栄養素（1人分・推定）</div>
        <button onClick={estimate} style={{background:"none",border:"none",color:G.sub,fontSize:11,cursor:"pointer"}}>再推定</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:4,textAlign:"center"}}>
        {[["カロリー",n.calories,"kcal","#e8825a"],["たんぱく質",n.protein,"g","#5a9ee8"],["脂質",n.fat,"g","#e8c05a"],["炭水化物",n.carbs,"g","#5ac87a"],["食物繊維",n.fiber,"g","#8a5ac8"]].map(([label,val,unit,color])=>(
          <div key={label} style={{background:color+"11",borderRadius:10,padding:"8px 4px",border:"1px solid "+color+"33"}}>
            <div style={{fontSize:9,color:G.sub,marginBottom:3}}>{label}</div>
            <div style={{fontSize:14,fontWeight:700,color}}>{val||0}</div>
            <div style={{fontSize:9,color:G.sub}}>{unit}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecipeCard({recipe,onClick,onDelete,onToggleFav,userName}){
  const [hov,setHov]=useState(false);
  const [confirmDelete,setConfirmDelete]=useState(false);
  const c1=tagColor(recipe.title||"a"),c2=tagColor((recipe.tags||["b"])[0]||"b");
  const cnt=(recipe.comments||[]).length;
  return(
    <>
      {confirmDelete&&<ConfirmDialog msg={"「"+recipe.title+"」を削除しますか？"} onOk={()=>{setConfirmDelete(false);onDelete(recipe.id);}} onCancel={()=>setConfirmDelete(false)}/>}
      <div onClick={onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
        style={{background:G.card,border:"2px solid "+(hov?c1:G.border),borderRadius:20,overflow:"hidden",cursor:"pointer",position:"relative",transform:hov?"translateY(-6px) scale(1.02)":"translateY(0) scale(1)",boxShadow:hov?"0 16px 40px "+c1+"44":"0 4px 14px #0004",transition:"all 0.22s cubic-bezier(.34,1.56,.64,1)"}}>
        <div style={{height:100,background:recipe.photo?"url("+recipe.photo+") center/cover":"linear-gradient(135deg,"+c1+"55,"+c2+"33)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:50,position:"relative"}}>
          {!recipe.photo&&(recipe.emoji||"🍽️")}
          <div style={{position:"absolute",top:7,left:7,display:"flex",gap:4}}>
            {cnt>0&&<span style={{background:"linear-gradient(135deg,#e8825a,#c85a8a)",color:"#fff",borderRadius:20,padding:"2px 7px",fontSize:9,fontWeight:700}}>💬{cnt}</span>}
            {(recipe.madeCount||0)>0&&<span style={{background:"linear-gradient(135deg,#5ac87a,#3aa85a)",color:"#fff",borderRadius:20,padding:"2px 7px",fontSize:9,fontWeight:700}}>🍳×{recipe.madeCount}</span>}
            {recipe.nutrition&&<span style={{background:"linear-gradient(135deg,#e8c05a,#c8a03a)",color:"#fff",borderRadius:20,padding:"2px 7px",fontSize:9,fontWeight:700}}>📊</span>}
          </div>
          <div style={{position:"absolute",top:7,right:7,display:"flex",gap:4}}>
            <button onClick={e=>{e.stopPropagation();onToggleFav(recipe.id);}} style={{background:"#000a",border:"none",borderRadius:"50%",width:26,height:26,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>{recipe.favorite?"⭐":"☆"}</button>
            {onDelete&&<button onClick={e=>{e.stopPropagation();setConfirmDelete(true);}} style={{background:"#000a",border:"none",borderRadius:"50%",width:26,height:26,cursor:"pointer",color:"#ccc",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>}
          </div>
          {recipe.addedBy&&recipe.addedBy!==userName&&<span style={{position:"absolute",bottom:6,left:8,background:"#5a9ee888",color:"#fff",borderRadius:10,padding:"1px 7px",fontSize:9,fontWeight:700}}>{"👤 "+recipe.addedBy}</span>}
        </div>
        <div style={{padding:"10px 12px 12px"}}>
          <div style={{fontFamily:"'Zen Kaku Gothic New',sans-serif",fontSize:14,fontWeight:700,color:G.text,marginBottom:2,lineHeight:1.35}}>{recipe.title}</div>
          <div style={{fontSize:11,color:G.sub,marginBottom:7,lineHeight:1.3}}>{recipe.description}</div>
          <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:7}}>{(recipe.tags||[]).slice(0,3).map((t,i)=><Tag key={i} label={t}/>)}</div>
          <div style={{display:"flex",gap:8,fontSize:10,color:"#666688"}}>
            {recipe.time&&<span>⏱ {recipe.time}</span>}
            {recipe.servings&&<span>👥 {recipe.servings}</span>}
          </div>
        </div>
      </div>
    </>
  );
}

function RecipeDetail({recipe,onClose,onUpdate,userName,onDelete,onCopy}){
  const [tab,setTab]=useState("recipe");
  const [editing,setEditing]=useState(false);
  const [editData,setEditData]=useState(null);
  const [commentText,setCommentText]=useState("");
  const [commentPhoto,setCommentPhoto]=useState(null);
  const [photoLoading,setPhotoLoading]=useState(false);
  const [showTagEditor,setShowTagEditor]=useState(false);
  const [confirmDelComment,setConfirmDelComment]=useState(null);
  const [confirmDelRecipe,setConfirmDelRecipe]=useState(false);
  const [showShare,setShowShare]=useState(false);
  const [showShopping,setShowShopping]=useState(false);
  const [servings,setServings]=useState(()=>{const n=parseInt(recipe.servings);return isNaN(n)?2:n;});
  const base=parseInt(recipe.servings)||2;
  const scale=servings/base;
  const c1=tagColor(recipe.title||"a");
  const photoRef=useRef(),heroRef=useRef(),stepRefs=useRef([]);

  const startEdit=()=>{setEditData({title:recipe.title||"",description:recipe.description||"",emoji:recipe.emoji||"🍳",time:recipe.time||"",servings:String(parseInt(recipe.servings)||2),source:recipe.source||"",sourceUrl:recipe.sourceUrl||"",tags:[...(recipe.tags||[])],ingredients:(recipe.ingredients||[]).length>0?[...recipe.ingredients]:[{name:"",amount:""}],steps:(recipe.steps||[]).length>0?[...recipe.steps]:[""]});setEditing(true);};
  const saveEdit=()=>{if(!editData.title.trim())return;onUpdate({...recipe,title:editData.title.trim(),description:editData.description.trim(),emoji:editData.emoji,time:editData.time.trim()||null,servings:editData.servings?editData.servings+"人分":null,source:editData.source.trim()||null,sourceUrl:editData.sourceUrl.trim()||null,tags:editData.tags,ingredients:editData.ingredients.filter(i=>i.name.trim()),steps:editData.steps.filter(s=>s.trim()),updatedAt:new Date().toISOString()});setEditing(false);};
  const incrementMade=()=>onUpdate({...recipe,madeCount:(recipe.madeCount||0)+1,lastMade:new Date().toLocaleDateString("ja-JP"),updatedAt:new Date().toISOString()});
  const handleHeroPhoto=async(f)=>{if(!f)return;try{const url=await compressAndUpload(f,"hero/"+recipe.id);onUpdate({...recipe,photo:url,updatedAt:new Date().toISOString()});}catch(e){alert("写真のアップロードに失敗しました: "+e.message);}};
  const handleStepPhoto=async(f,i)=>{if(!f)return;try{const url=await compressAndUpload(f,"steps/"+recipe.id+"_"+i);const sp={...(recipe.stepPhotos||{})};sp[i]=url;onUpdate({...recipe,stepPhotos:sp,updatedAt:new Date().toISOString()});}catch(e){alert("写真のアップロードに失敗しました: "+e.message);}};
  const handleCommentPhoto=async(f)=>{if(!f)return;setPhotoLoading(true);try{const url=await compressAndUpload(f,"comments/"+userName+"_"+Date.now());setCommentPhoto(url);}catch(e){alert("写真のアップロードに失敗しました: "+e.message);}finally{setPhotoLoading(false);}};
  const submitComment=()=>{if(!commentText.trim()&&!commentPhoto)return;onUpdate({...recipe,comments:[...(recipe.comments||[]),{id:Date.now(),author:userName,text:commentText.trim(),photo:commentPhoto,createdAt:new Date().toLocaleDateString("ja-JP")}],updatedAt:new Date().toISOString()});setCommentText("");setCommentPhoto(null);};
  const inS={padding:"9px 12px",borderRadius:10,border:"1.5px solid "+G.border,background:G.input,color:G.text,fontSize:13,WebkitAppearance:"none",appearance:"none"};

  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"#000d",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      {showTagEditor&&<TagEditor tags={editing?editData.tags:recipe.tags||[]} onSave={tags=>{if(editing)setEditData(d=>({...d,tags}));else onUpdate({...recipe,tags,updatedAt:new Date().toISOString()});setShowTagEditor(false);}} onClose={()=>setShowTagEditor(false)}/>}
      {confirmDelComment&&<ConfirmDialog msg="この記録を削除しますか？" onOk={()=>{onUpdate({...recipe,comments:(recipe.comments||[]).filter(c=>c.id!==confirmDelComment),updatedAt:new Date().toISOString()});setConfirmDelComment(null);}} onCancel={()=>setConfirmDelComment(null)}/>}
      {confirmDelRecipe&&<ConfirmDialog msg={"「"+recipe.title+"」を削除しますか？"} onOk={async()=>{await deleteStoragePhotos(extractStoragePaths(recipe));onDelete(recipe.id);onClose();}} onCancel={()=>setConfirmDelRecipe(false)}/>}
      {showShare&&<ShareModal recipe={recipe} onClose={()=>setShowShare(false)}/>}
      {showShopping&&<ShoppingList recipe={recipe} onClose={()=>setShowShopping(false)}/>}

      <div onClick={e=>e.stopPropagation()} style={{background:G.dark,borderRadius:24,maxWidth:540,width:"100%",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 30px 80px #000c",border:"2px solid "+c1+"55"}}>
        <div style={{height:150,background:recipe.photo?"url("+recipe.photo+") center/cover":"linear-gradient(135deg,"+c1+"66,#1e1a2e)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:82,borderRadius:"22px 22px 0 0",position:"relative"}}>
          {!recipe.photo&&(recipe.emoji||"🍽️")}
          <button onClick={onClose} style={{position:"absolute",top:12,right:12,background:"#000a",border:"none",borderRadius:"50%",width:34,height:34,cursor:"pointer",color:"#fff",fontSize:16}}>✕</button>
          <input ref={heroRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)handleHeroPhoto(f);e.target.value="";}}/>
          <div style={{position:"absolute",bottom:10,left:12}}>
            <button onClick={incrementMade} style={{background:"linear-gradient(135deg,#5ac87a,#3aa85a)",border:"none",borderRadius:10,padding:"5px 10px",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>{"🍳 作った！"+(recipe.madeCount>0?" ("+recipe.madeCount+")":"")}</button>
          </div>
          <div style={{position:"absolute",bottom:10,right:12,display:"flex",gap:5}}>
            <button onClick={()=>heroRef.current?.click()} style={{background:"#000a",border:"1px solid #ffffff44",borderRadius:10,padding:"5px 10px",color:"#fff",fontSize:11,cursor:"pointer"}}>📷</button>
            <button onClick={()=>setShowShare(true)} style={{background:"#000a",border:"1px solid #ffffff44",borderRadius:10,padding:"5px 10px",color:"#fff",fontSize:11,cursor:"pointer"}}>🔗</button>
            <button onClick={startEdit} style={{background:"linear-gradient(135deg,#e8825a,#c8603a)",border:"none",borderRadius:10,padding:"5px 10px",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>✏️ 編集</button>
          </div>
        </div>

        <div style={{padding:"18px 20px 30px"}}>
          {editing?(
            <div>
              <div style={{fontFamily:"'Zen Kaku Gothic New',sans-serif",fontSize:18,fontWeight:900,color:G.accent,marginBottom:16}}>✏️ レシピを編集</div>
              <div style={{display:"flex",gap:10,marginBottom:10}}>
                <input value={editData.emoji} onChange={e=>setEditData(d=>({...d,emoji:e.target.value}))} style={{...inS,width:56,textAlign:"center",fontSize:22,padding:"8px"}}/>
                <input value={editData.title} onChange={e=>setEditData(d=>({...d,title:e.target.value}))} placeholder="料理名" style={{...inS,flex:1}}/>
              </div>
              <input value={editData.description} onChange={e=>setEditData(d=>({...d,description:e.target.value}))} placeholder="一言説明" style={{...inS,width:"100%",marginBottom:10,display:"block"}}/>
              <div style={{display:"flex",gap:10,marginBottom:10}}>
                <input value={editData.time} onChange={e=>setEditData(d=>({...d,time:e.target.value}))} placeholder="調理時間" style={{...inS,flex:1}}/>
                <input value={editData.servings} onChange={e=>setEditData(d=>({...d,servings:e.target.value}))} placeholder="人数" type="number" min="1" style={{...inS,flex:1}}/>
              </div>
              <input value={editData.source} onChange={e=>setEditData(d=>({...d,source:e.target.value}))} placeholder="出典・SNS" style={{...inS,width:"100%",marginBottom:10,display:"block"}}/>
              <input value={editData.sourceUrl} onChange={e=>setEditData(d=>({...d,sourceUrl:e.target.value}))} placeholder="参照URL" style={{...inS,width:"100%",marginBottom:14,display:"block"}}/>
              <div style={{marginBottom:14}}>
                <div style={{fontSize:12,color:G.sub,marginBottom:8}}>🏷 タグ</div>
                <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
                  {editData.tags.map((t,i)=><Tag key={i} label={t} active onRemove={()=>setEditData(d=>({...d,tags:d.tags.filter((_,idx)=>idx!==i)}))}/>)}
                  <button onClick={()=>setShowTagEditor(true)} style={{background:G.accent+"22",border:"1.5px dashed "+G.accent+"88",borderRadius:20,padding:"3px 10px",color:G.accent,fontSize:11,fontWeight:700,cursor:"pointer"}}>＋ タグ編集</button>
                </div>
              </div>
              <div style={{marginBottom:14}}>
                <div style={{fontSize:12,color:G.sub,marginBottom:8}}>🥘 材料</div>
                {editData.ingredients.map((ing,i)=>(
                  <div key={i} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
                    <input value={ing.name} onChange={e=>{const a=[...editData.ingredients];a[i]={...a[i],name:e.target.value};setEditData(d=>({...d,ingredients:a}));}} placeholder="材料名" style={{...inS,flex:2}}/>
                    <input value={ing.amount} onChange={e=>{const a=[...editData.ingredients];a[i]={...a[i],amount:e.target.value};setEditData(d=>({...d,ingredients:a}));}} placeholder="分量" style={{...inS,flex:1}}/>
                    <button onClick={()=>setEditData(d=>({...d,ingredients:d.ingredients.filter((_,idx)=>idx!==i)}))} style={{background:G.input,border:"1.5px solid "+G.border,borderRadius:8,width:34,height:36,color:G.sub,cursor:"pointer",fontSize:14,flexShrink:0}}>✕</button>
                  </div>
                ))}
                <button onClick={()=>setEditData(d=>({...d,ingredients:[...d.ingredients,{name:"",amount:""}]}))} style={{width:"100%",padding:9,borderRadius:10,border:"1.5px dashed "+G.border,background:G.input,color:G.sub,fontSize:13,cursor:"pointer"}}>＋ 材料を追加</button>
              </div>
              <div style={{marginBottom:18}}>
                <div style={{fontSize:12,color:G.sub,marginBottom:8}}>👨‍🍳 作り方</div>
                {editData.steps.map((step,i)=>(
                  <div key={i} style={{marginBottom:12}}>
                    <div style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:6}}>
                      <div style={{background:"linear-gradient(135deg,#5ac87a,#3aa85a)",color:"#fff",borderRadius:"50%",minWidth:26,height:26,marginTop:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700}}>{i+1}</div>
                      <textarea value={step} onChange={e=>{const a=[...editData.steps];a[i]=e.target.value;setEditData(d=>({...d,steps:a}));}} rows={2} placeholder={"手順 "+(i+1)} style={{...inS,flex:1,resize:"vertical"}}/>
                      <button onClick={()=>setEditData(d=>({...d,steps:d.steps.filter((_,idx)=>idx!==i)}))} style={{background:G.input,border:"1.5px solid "+G.border,borderRadius:8,width:34,height:34,marginTop:4,color:G.sub,cursor:"pointer",fontSize:14,flexShrink:0}}>✕</button>
                    </div>
                    <div style={{marginLeft:34}}>
                      <input ref={el=>{stepRefs.current[i]=el;}} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)handleStepPhoto(f,i);e.target.value="";}}/>
                      {recipe.stepPhotos?.[i]?(
                        <div style={{position:"relative"}}>
                          <img src={recipe.stepPhotos[i]} style={{width:"100%",borderRadius:10,maxHeight:160,objectFit:"cover"}}/>
                          <div style={{position:"absolute",bottom:6,right:6,display:"flex",gap:4}}>
                            <button onClick={()=>stepRefs.current[i]?.click()} style={{background:"#000a",border:"1px solid #fff4",borderRadius:8,padding:"3px 8px",color:"#fff",fontSize:10,cursor:"pointer"}}>📷 変更</button>
                            <button onClick={()=>{const sp={...(recipe.stepPhotos||{})};delete sp[i];onUpdate({...recipe,stepPhotos:sp,updatedAt:new Date().toISOString()});}} style={{background:"#e85a5a88",border:"none",borderRadius:8,padding:"3px 8px",color:"#fff",fontSize:10,cursor:"pointer"}}>削除</button>
                          </div>
                        </div>
                      ):(
                        <button onClick={()=>stepRefs.current[i]?.click()} style={{padding:"6px 12px",borderRadius:8,border:"1.5px dashed "+G.border,background:G.input,color:G.sub,fontSize:12,cursor:"pointer"}}>📷 手順写真を追加</button>
                      )}
                    </div>
                  </div>
                ))}
                <button onClick={()=>setEditData(d=>({...d,steps:[...d.steps,""]}))} style={{width:"100%",padding:9,borderRadius:10,border:"1.5px dashed "+G.border,background:G.input,color:G.sub,fontSize:13,cursor:"pointer"}}>＋ 手順を追加</button>
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setEditing(false)} style={{flex:1,padding:"12px",borderRadius:12,border:"1.5px solid "+G.border,background:G.input,color:G.sub,fontWeight:700,cursor:"pointer",fontSize:14}}>キャンセル</button>
                <button onClick={saveEdit} style={{flex:2,padding:"12px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#e8825a,#c8603a)",color:"#fff",fontWeight:700,cursor:"pointer",fontSize:14}}>💾 保存する</button>
              </div>
            </div>
          ):(
            <div>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:4,gap:8}}>
                <div style={{fontFamily:"'Zen Kaku Gothic New',sans-serif",fontSize:22,fontWeight:900,color:G.text,lineHeight:1.2,flex:1}}>{recipe.title}</div>
                <div style={{display:"flex",gap:6,flexShrink:0}}>
                  <button onClick={()=>onCopy(recipe)} style={{background:G.blue+"22",border:"none",color:G.blue,cursor:"pointer",fontSize:13,padding:"4px 8px",borderRadius:8,fontWeight:700}}>📋 コピー</button>
                  <button onClick={()=>setConfirmDelRecipe(true)} style={{background:"none",border:"none",color:"#e85a5a",cursor:"pointer",fontSize:16,padding:"4px"}}>🗑</button>
                </div>
              </div>
              <div style={{color:G.sub,fontSize:13,marginBottom:10}}>{recipe.description}</div>
              {recipe.lastMade&&<div style={{fontSize:11,color:G.green,marginBottom:10}}>{"✅ 最終調理: "+recipe.lastMade+(recipe.madeCount>1?" ("+recipe.madeCount+"回)":"")}</div>}
              <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14,alignItems:"center"}}>
                {(recipe.tags||[]).map((t,i)=><Tag key={i} label={t}/>)}
                <button onClick={()=>setShowTagEditor(true)} style={{background:G.accent+"22",border:"1.5px dashed "+G.accent+"88",borderRadius:20,padding:"3px 10px",color:G.accent,fontSize:11,fontWeight:700,cursor:"pointer"}}>＋ タグ</button>
              </div>
              <div style={{display:"flex",gap:10,background:G.card,borderRadius:14,padding:"10px 14px",marginBottom:14,fontSize:12,color:G.sub,flexWrap:"wrap",alignItems:"center"}}>
                {recipe.time&&<span>⏱ {recipe.time}</span>}
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span>👥</span>
                  <button onClick={()=>setServings(Math.max(1,servings-1))} style={{background:G.input,border:"1.5px solid "+G.border,borderRadius:6,width:24,height:24,color:"#fff",fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>-</button>
                  <span style={{fontWeight:700,color:scale!==1?G.accent:G.text,minWidth:22,textAlign:"center"}}>{servings}</span>
                  <button onClick={()=>setServings(servings+1)} style={{background:G.input,border:"1.5px solid "+G.border,borderRadius:6,width:24,height:24,color:"#fff",fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
                  <span>人分</span>
                </div>
                {recipe.addedBy&&<span>👤 {recipe.addedBy}</span>}
                {recipe.addedAt&&<span>📅 {recipe.addedAt}</span>}
              </div>
              {(recipe.source||recipe.sourceUrl)&&(
                <div style={{background:G.card,borderRadius:12,padding:"10px 14px",marginBottom:14,border:"1.5px solid "+G.accent+"33"}}>
                  {recipe.source&&<div style={{fontSize:12,color:G.sub,marginBottom:4}}>📌 {recipe.source}</div>}
                  {recipe.sourceUrl&&<a href={recipe.sourceUrl} target="_blank" rel="noreferrer" style={{color:G.blue,fontSize:12,wordBreak:"break-all",textDecoration:"none"}}>{recipe.sourceUrl}</a>}
                </div>
              )}
              <NutritionPanel recipe={recipe} onUpdate={onUpdate}/>
              <div style={{display:"flex",background:G.card,borderRadius:14,padding:4,marginBottom:18,gap:4}}>
                {[{id:"recipe",label:"📋 レシピ"},{id:"comments",label:"💬 記録"+((recipe.comments||[]).length>0?" ("+(recipe.comments.length)+")":"")}].map(t=>(
                  <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,padding:"9px",borderRadius:11,border:"none",background:tab===t.id?"linear-gradient(135deg,#e8825a,#c8603a)":"transparent",color:tab===t.id?"#fff":G.sub,fontWeight:tab===t.id?700:400,cursor:"pointer",fontSize:12}}>{t.label}</button>
                ))}
              </div>
              {tab==="recipe"&&(
                <div>
                  {recipe.ingredients?.length>0&&(
                    <div style={{marginBottom:20}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                        <div style={{fontWeight:700,color:G.accent,fontSize:13}}>🥘 材料{scale!==1&&<span style={{fontWeight:400,fontSize:11,marginLeft:8}}>（×{scale.toFixed(1)} 換算）</span>}</div>
                        <button onClick={()=>setShowShopping(true)} style={{background:G.green+"22",border:"1px solid "+G.green+"55",borderRadius:10,padding:"4px 10px",color:G.green,fontSize:11,fontWeight:700,cursor:"pointer"}}>🛒 買い物リスト</button>
                      </div>
                      <div style={{background:G.card,borderRadius:14,padding:"6px 14px",border:"1.5px solid "+G.accent+"33"}}>
                        {recipe.ingredients.map((ing,i)=>(
                          <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:i<recipe.ingredients.length-1?"1px solid "+G.border+"66":"none",fontSize:13}}>
                            <span style={{color:G.text}}>{ing.name}</span>
                            <span style={{color:scale!==1?G.accent:G.sub,fontWeight:scale!==1?700:400}}>{scaleAmount(ing.amount,scale)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {recipe.steps?.length>0&&(
                    <div>
                      <div style={{fontWeight:700,color:G.green,fontSize:13,marginBottom:10}}>👨‍🍳 作り方</div>
                      {recipe.steps.map((step,i)=>(
                        <div key={i} style={{background:G.card,borderRadius:14,padding:"12px 14px",marginBottom:10,border:"1.5px solid "+G.green+"33"}}>
                          <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                            <div style={{background:"linear-gradient(135deg,#5ac87a,#3aa85a)",color:"#fff",borderRadius:"50%",minWidth:26,height:26,marginTop:1,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700}}>{i+1}</div>
                            <div style={{flex:1,fontSize:13,color:G.text,lineHeight:1.75}}>{step}</div>
                          </div>
                          {recipe.stepPhotos?.[i]&&<img src={recipe.stepPhotos[i]} style={{width:"100%",borderRadius:10,maxHeight:200,objectFit:"cover",marginTop:10}}/>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {tab==="comments"&&(
                <div>
                  {(recipe.comments||[]).length===0?(
                    <div style={{textAlign:"center",padding:"28px 0"}}>
                      <div style={{fontSize:40,marginBottom:10}}>📷</div>
                      <div style={{fontSize:13,color:G.sub}}>まだ記録がありません</div>
                    </div>
                  ):(
                    <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:20}}>
                      {(recipe.comments||[]).map(c=>(
                        <div key={c.id} style={{background:G.card,borderRadius:14,padding:"12px 14px",border:"1.5px solid "+G.border}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:9}}>
                            <div style={{width:28,height:28,borderRadius:"50%",flexShrink:0,background:"linear-gradient(135deg,#e8825a,#8a5ac8)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#fff"}}>{(c.author||"?")[0].toUpperCase()}</div>
                            <div style={{flex:1}}>
                              <div style={{fontSize:12,fontWeight:700,color:G.text}}>{c.author}</div>
                              <div style={{fontSize:10,color:G.sub}}>{c.createdAt}</div>
                            </div>
                            {c.author===userName&&<button onClick={()=>setConfirmDelComment(c.id)} style={{background:"none",border:"none",color:"#e85a5a",cursor:"pointer",fontSize:16}}>🗑</button>}
                          </div>
                          {c.photo&&<img src={c.photo} style={{width:"100%",borderRadius:10,marginBottom:c.text?9:0,maxHeight:240,objectFit:"cover"}}/>}
                          {c.text&&<div style={{fontSize:13,color:"#c0b8d0",lineHeight:1.75}}>{c.text}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{background:G.card,borderRadius:16,padding:14,border:"1.5px solid "+G.border}}>
                    <div style={{fontSize:12,fontWeight:700,color:G.accent,marginBottom:10}}>▸ 記録を追加</div>
                    <textarea value={commentText} onChange={e=>setCommentText(e.target.value)} placeholder="感想・アレンジ・メモなど..." rows={3} style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"1.5px solid "+G.border,background:G.input,color:G.text,fontSize:13,resize:"none",boxSizing:"border-box",lineHeight:1.6,marginBottom:10,display:"block",WebkitAppearance:"none"}}/>
                    {photoLoading&&<div style={{color:G.accent,fontSize:12,marginBottom:8,textAlign:"center"}}>アップロード中...</div>}
                    {commentPhoto&&!photoLoading&&(
                      <div style={{position:"relative",marginBottom:10}}>
                        <img src={commentPhoto} style={{width:"100%",borderRadius:10,maxHeight:180,objectFit:"cover"}}/>
                        <button onClick={()=>setCommentPhoto(null)} style={{position:"absolute",top:7,right:7,background:"#000b",border:"none",borderRadius:"50%",width:28,height:28,cursor:"pointer",color:"#fff",fontSize:14}}>✕</button>
                      </div>
                    )}
                    <input ref={photoRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)handleCommentPhoto(f);e.target.value="";}}/>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={()=>photoRef.current?.click()} style={{padding:"9px 14px",borderRadius:10,border:"1.5px solid "+G.border,background:G.input,color:G.sub,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>📷 写真</button>
                      <button onClick={submitComment} disabled={!commentText.trim()&&!commentPhoto} style={{flex:1,padding:"9px",borderRadius:10,border:"none",background:(!commentText.trim()&&!commentPhoto)?G.input:"linear-gradient(135deg,#e8825a,#c8603a)",color:"#fff",fontSize:13,fontWeight:700,cursor:(!commentText.trim()&&!commentPhoto)?"default":"pointer"}}>投稿する</button>
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

function ManualForm({onAdd,onBack}){
  const [title,setTitle]=useState(""),[description,setDescription]=useState(""),
    [emoji,setEmoji]=useState("🍳"),[time,setTime]=useState(""),
    [servings,setServings]=useState("2"),[source,setSource]=useState(""),
    [tags,setTags]=useState([]),[ingredients,setIngredients]=useState([{name:"",amount:""}]),
    [steps,setSteps]=useState([""]),[showTagEditor,setShowTagEditor]=useState(false),
    [toast,setToast]=useState("");
  const inS={padding:"11px 14px",borderRadius:12,border:"1.5px solid "+G.border,background:G.input,color:G.text,fontSize:14,display:"block",width:"100%",marginBottom:10,WebkitAppearance:"none",appearance:"none"};
  const submit=()=>{if(!title.trim()){setToast("⚠️ 料理名を入力してください");return;}onAdd({title:title.trim(),description:description.trim(),emoji,time:time.trim()||null,servings:servings?servings+"人分":null,source:source.trim()||"自作",sourceUrl:null,tags,ingredients:ingredients.filter(i=>i.name.trim()),steps:steps.filter(s=>s.trim()),comments:[]});};
  return(
    <div style={{minHeight:"100vh",background:G.dark,padding:24}}>
      <style>{CSS}</style>
      {showTagEditor&&<TagEditor tags={tags} onSave={t=>{setTags(t);setShowTagEditor(false);}} onClose={()=>setShowTagEditor(false)}/>}
      <div style={{maxWidth:500,margin:"0 auto"}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:G.accent,fontSize:14,cursor:"pointer",padding:0,marginBottom:20}}>← 戻る</button>
        <div style={{fontFamily:"'Zen Kaku Gothic New',sans-serif",fontSize:22,fontWeight:900,color:G.text,marginBottom:20}}>✍️ レシピを手書き</div>
        <div style={{display:"flex",gap:10}}>
          <div><div style={{fontSize:12,color:G.sub,marginBottom:6}}>絵文字</div><input value={emoji} onChange={e=>setEmoji(e.target.value)} style={{...inS,width:60,textAlign:"center",fontSize:24,padding:"8px"}}/></div>
          <div style={{flex:1}}><div style={{fontSize:12,color:G.sub,marginBottom:6}}>料理名 *</div><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="例：唐揚げ" style={inS}/></div>
        </div>
        <div style={{fontSize:12,color:G.sub,marginBottom:6}}>一言説明</div>
        <input value={description} onChange={e=>setDescription(e.target.value)} placeholder="例：サクサクジューシー！" style={inS}/>
        <div style={{display:"flex",gap:10}}>
          <div style={{flex:1}}><div style={{fontSize:12,color:G.sub,marginBottom:6}}>⏱ 調理時間</div><input value={time} onChange={e=>setTime(e.target.value)} placeholder="30分" style={inS}/></div>
          <div style={{flex:1}}><div style={{fontSize:12,color:G.sub,marginBottom:6}}>👥 人数</div><input value={servings} onChange={e=>setServings(e.target.value)} placeholder="2" type="number" min="1" style={inS}/></div>
        </div>
        <div style={{fontSize:12,color:G.sub,marginBottom:6}}>📌 出典・SNS</div>
        <input value={source} onChange={e=>setSource(e.target.value)} placeholder="例：自作 / Instagram" style={inS}/>
        <div style={{marginBottom:14}}>
          <div style={{fontSize:12,color:G.sub,marginBottom:8}}>🏷 タグ</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {tags.map((t,i)=><Tag key={i} label={t} active onRemove={()=>setTags(tags.filter((_,idx)=>idx!==i))}/>)}
            <button onClick={()=>setShowTagEditor(true)} style={{background:G.accent+"22",border:"1.5px dashed "+G.accent+"88",borderRadius:20,padding:"3px 10px",color:G.accent,fontSize:11,fontWeight:700,cursor:"pointer"}}>＋ タグを追加</button>
          </div>
        </div>
        <div style={{marginBottom:14}}>
          <div style={{fontSize:12,color:G.sub,marginBottom:8}}>🥘 材料</div>
          {ingredients.map((ing,i)=>(
            <div key={i} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
              <input value={ing.name} onChange={e=>{const a=[...ingredients];a[i]={...a[i],name:e.target.value};setIngredients(a);}} placeholder="材料名" style={{flex:2,padding:"9px 12px",borderRadius:10,border:"1.5px solid "+G.border,background:G.input,color:G.text,fontSize:13,WebkitAppearance:"none"}}/>
              <input value={ing.amount} onChange={e=>{const a=[...ingredients];a[i]={...a[i],amount:e.target.value};setIngredients(a);}} placeholder="分量" style={{flex:1,padding:"9px 12px",borderRadius:10,border:"1.5px solid "+G.border,background:G.input,color:G.text,fontSize:13,WebkitAppearance:"none"}}/>
              <button onClick={()=>setIngredients(ingredients.filter((_,idx)=>idx!==i))} style={{background:G.input,border:"1.5px solid "+G.border,borderRadius:8,width:36,height:36,color:G.sub,cursor:"pointer",fontSize:14,flexShrink:0}}>✕</button>
            </div>
          ))}
          <button onClick={()=>setIngredients([...ingredients,{name:"",amount:""}])} style={{width:"100%",padding:9,borderRadius:10,border:"1.5px dashed "+G.border,background:G.input,color:G.sub,fontSize:13,cursor:"pointer"}}>＋ 材料を追加</button>
        </div>
        <div style={{marginBottom:24}}>
          <div style={{fontSize:12,color:G.sub,marginBottom:8}}>👨‍🍳 作り方</div>
          {steps.map((step,i)=>(
            <div key={i} style={{display:"flex",gap:8,marginBottom:8,alignItems:"flex-start"}}>
              <div style={{background:"linear-gradient(135deg,#5ac87a,#3aa85a)",color:"#fff",borderRadius:"50%",minWidth:26,height:26,marginTop:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700}}>{i+1}</div>
              <textarea value={step} onChange={e=>{const a=[...steps];a[i]=e.target.value;setSteps(a);}} placeholder={"手順 "+(i+1)} rows={2} style={{flex:1,padding:"9px 12px",borderRadius:10,border:"1.5px solid "+G.border,background:G.input,color:G.text,fontSize:13,resize:"vertical",WebkitAppearance:"none"}}/>
              <button onClick={()=>setSteps(steps.filter((_,idx)=>idx!==i))} style={{background:G.input,border:"1.5px solid "+G.border,borderRadius:8,width:36,height:36,marginTop:4,color:G.sub,cursor:"pointer",fontSize:14,flexShrink:0}}>✕</button>
            </div>
          ))}
          <button onClick={()=>setSteps([...steps,""])} style={{width:"100%",padding:9,borderRadius:10,border:"1.5px dashed "+G.border,background:G.input,color:G.sub,fontSize:13,cursor:"pointer"}}>＋ 手順を追加</button>
        </div>
        <button onClick={submit} style={{width:"100%",padding:"15px",borderRadius:14,border:"none",background:title.trim()?"linear-gradient(135deg,#e8825a,#c8603a)":G.input,color:G.text,fontSize:15,fontWeight:700,cursor:title.trim()?"pointer":"default",boxShadow:title.trim()?"0 4px 16px #e8825a44":"none"}}>🍳 レシピを保存</button>
      </div>
      <Toast msg={toast} onClear={()=>setToast("")}/>
    </div>
  );
}

function AddScreen({onBack,onAdd,userName}){
  const [mode,setMode]=useState("image");
  const [textInput,setTextInput]=useState("");
  const [loading,setLoading]=useState(false);
  const [loadingMsg,setLoadingMsg]=useState("");
  const [toast,setToast]=useState("");
  const fileRef=useRef();
  if(mode==="manual")return <ManualForm onAdd={r=>onAdd({...r,addedBy:userName,addedAt:new Date().toLocaleDateString("ja-JP")})} onBack={()=>setMode("image")}/>;
  const process=async({imageFile,text})=>{
    setLoading(true);setLoadingMsg(imageFile?"🤖 解析中...":"🔍 取得中...");
    try{const data=await extractRecipe({imageFile,text});onAdd({...data,id:Date.now(),addedBy:userName,addedAt:new Date().toLocaleDateString("ja-JP"),updatedAt:new Date().toISOString(),comments:[],sourceUrl:data.sourceUrl||(typeof text==="string"&&text.startsWith("http")?text:null)});}
    catch(e){setLoading(false);setToast("❌ "+e.message);}
  };
  return(
    <div style={{minHeight:"100vh",background:G.dark,padding:24}}>
      <style>{CSS}</style>
      <div style={{maxWidth:500,margin:"0 auto"}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:G.accent,fontSize:14,cursor:"pointer",padding:0,marginBottom:22}}>← 戻る</button>
        <div style={{fontFamily:"'Zen Kaku Gothic New',sans-serif",fontSize:22,fontWeight:900,color:G.text,marginBottom:20}}>レシピを追加</div>
        <div style={{display:"flex",background:G.card,borderRadius:14,padding:4,marginBottom:22,gap:3,border:"1.5px solid "+G.border}}>
          {[{id:"image",label:"📸 スクショ"},{id:"text",label:"🔗 URL"},{id:"manual",label:"✍️ 手書き"}].map(m=>(
            <button key={m.id} onClick={()=>setMode(m.id)} style={{flex:1,padding:"10px 6px",borderRadius:11,border:"none",background:mode===m.id?"linear-gradient(135deg,#e8825a,#c8603a)":"transparent",color:mode===m.id?"#fff":G.sub,fontWeight:mode===m.id?700:400,cursor:"pointer",fontSize:12}}>{m.label}</button>
          ))}
        </div>
        {mode==="image"&&(
          <div>
            <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)process({imageFile:f});e.target.value="";}}/>
            <div onClick={()=>!loading&&fileRef.current?.click()} style={{border:"2px solid "+G.accent,borderRadius:20,padding:"44px 24px",textAlign:"center",cursor:loading?"default":"pointer",background:"linear-gradient(135deg,#1a1630,#141828)"}}>
              {loading?<Loader msg={loadingMsg}/>:(
                <div>
                  <div style={{fontSize:52,marginBottom:14}}>📱</div>
                  <div style={{color:G.text,fontWeight:700,marginBottom:6,fontSize:15}}>レシピ画像をアップロード</div>
                  <div style={{color:G.sub,fontSize:13,lineHeight:1.8}}>SNSのスクショや料理写真をタップ</div>
                  <div style={{marginTop:18,display:"inline-flex",background:"linear-gradient(135deg,#e8825a,#c8603a)",color:"#fff",borderRadius:12,padding:"10px 24px",fontSize:13,fontWeight:700,boxShadow:"0 4px 16px #e8825a44"}}>📂 ファイルを選択</div>
                </div>
              )}
            </div>
          </div>
        )}
        {mode==="text"&&(
          <div>
            <textarea value={textInput} onChange={e=>setTextInput(e.target.value)} placeholder={"URLやSNS投稿テキストを貼り付け\n\n例: https://cookpad.com/recipe/..."} rows={7} style={{width:"100%",padding:"14px 16px",borderRadius:14,border:"1.5px solid "+G.border,background:G.card,color:G.text,fontSize:14,resize:"vertical",boxSizing:"border-box",lineHeight:1.6,display:"block",WebkitAppearance:"none"}}/>
            <button onClick={()=>process({text:textInput})} disabled={loading||!textInput.trim()} style={{width:"100%",marginTop:12,padding:"14px",borderRadius:14,border:"none",background:loading||!textInput.trim()?G.input:"linear-gradient(135deg,#e8825a,#c8603a)",color:G.text,fontSize:15,fontWeight:700,cursor:loading||!textInput.trim()?"default":"pointer"}}>{loading?<Loader msg={loadingMsg}/>:"🤖 AIでレシピを抽出"}</button>
          </div>
        )}
      </div>
      <Toast msg={toast} onClear={()=>setToast("")}/>
    </div>
  );
}

export default function App(){
  const [authed,setAuthed]=useState(()=>{
    if(typeof window==="undefined")return false;
    return localStorage.getItem(AUTH_KEY)==="ok";
  });
  const [pwInput,setPwInput]=useState("");
  const [pwError,setPwError]=useState(false);
  const [userName,setUserName]=useState("");
  const [nameInput,setNameInput]=useState("");
  const [recipes,setRecipes]=useState([]);
  const [view,setView]=useState("home");
  const [selected,setSelected]=useState(null);
  const [search,setSearch]=useState("");
  const [activeTag,setActiveTag]=useState("");
  const [sortBy,setSortBy]=useState("date");
  const [sortOpen,setSortOpen]=useState(false);
  const [filterFav,setFilterFav]=useState(false);
  const [showHistory,setShowHistory]=useState(false);
  const [showTagManagement,setShowTagManagement]=useState(false);
  const [history,setHistory]=useState([]);
  const [toast,setToast]=useState("");
  const [sharedRecipe,setSharedRecipe]=useState(null);
  const [syncStatus,setSyncStatus]=useState("");
  const [lastSync,setLastSync]=useState(null);
  const [members,setMembers]=useState([]);

  const checkPassword=()=>{
    if(pwInput===APP_PASSWORD){localStorage.setItem(AUTH_KEY,"ok");setAuthed(true);setPwError(false);}
    else{setPwError(true);setPwInput("");}
  };

  useEffect(()=>{
    try{
      const h=localStorage.getItem(HISTORY_KEY);if(h)setHistory(JSON.parse(h));
      const n=localStorage.getItem("rs-name");if(n)setUserName(n);
    }catch{}
    const sr=parseShareParam();if(sr)setSharedRecipe(sr);
  },[]);

  useEffect(()=>{if(!userName)return;initialSync();},[userName]);
  useEffect(()=>{
    if(!userName)return;
    const interval=setInterval(()=>syncData(false),30000);
    return()=>clearInterval(interval);
  },[userName,recipes]);

  const mergeRecipes=(local,remote)=>{
    const map=new Map();
    local.forEach(r=>map.set(r.id,r));
    remote.forEach(r=>{
      const ex=map.get(r.id);
      if(!ex){map.set(r.id,r);return;}
      const lu=toMs(ex.updatedAt||ex.addedAt);
      const ru=toMs(r.updatedAt||r.addedAt);
      if(ru>lu)map.set(r.id,r);
    });
    return Array.from(map.values());
  };

  const initialSync=async()=>{
    setSyncStatus("syncing");
    try{
      const remote=await fetchRemote(userName);
      const localSaved=JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]");
      const merged=mergeRecipes(localSaved,remote.recipes||[]);
      setRecipes(merged);localStorage.setItem(STORAGE_KEY,JSON.stringify(merged));
      setMembers(remote.members||[]);
      await doSync(merged,userName);
      setSyncStatus("ok");setLastSync(Date.now());
    }catch(e){
      try{const s=localStorage.getItem(STORAGE_KEY);if(s)setRecipes(JSON.parse(s));}catch{}
      setSyncStatus("error");
    }
  };

  const syncData=async(manual=true)=>{
    setSyncStatus("syncing");
    try{
      const result=await doSync(recipes,userName);
      const merged=mergeRecipes(recipes,result.recipes||[]);
      setRecipes(merged);localStorage.setItem(STORAGE_KEY,JSON.stringify(merged));
      setMembers(result.members||[]);
      setSyncStatus("ok");setLastSync(Date.now());
      if(manual)setToast("✅ 同期しました");
    }catch(e){setSyncStatus("error");if(manual)setToast("❌ 同期失敗");}
  };

  const persist=(updated)=>{
    setRecipes(updated);
    localStorage.setItem(STORAGE_KEY,JSON.stringify(updated));
    doSync(updated,userName).then(r=>{
      if(r?.recipes){
        const merged=mergeRecipes(updated,r.recipes);
        setRecipes(merged);
        localStorage.setItem(STORAGE_KEY,JSON.stringify(merged));
      }
      if(r?.members)setMembers(r.members);
      setSyncStatus("ok");setLastSync(Date.now());
    }).catch(()=>setSyncStatus("error"));
  };

  const persistHistory=(h)=>{setHistory(h);try{localStorage.setItem(HISTORY_KEY,JSON.stringify(h));}catch{}};

  const handleAdd=(recipe)=>{
    const r={...recipe,id:recipe.id||Date.now(),addedBy:recipe.addedBy||userName,addedAt:recipe.addedAt||new Date().toLocaleDateString("ja-JP"),updatedAt:recipe.updatedAt||new Date().toISOString()};
    persist([r,...recipes]);setToast("✅ 追加しました！");setView("home");
  };
  const handleDelete=async(id)=>{
    const recipe=recipes.find(r=>r.id===id);
    if(recipe&&!recipe.deleted)await deleteStoragePhotos(extractStoragePaths(recipe));
    const tombstone={id,deleted:true,updatedAt:new Date().toISOString()};
    persist(recipes.map(r=>r.id===id?tombstone:r));
    setToast("🗑 削除しました");
  };
  const handleUpdate=(updated)=>{const l=recipes.map(r=>r.id===updated.id?updated:r);persist(l);setSelected(updated);};
  const handleToggleFav=(id)=>{persist(recipes.map(r=>r.id===id?{...r,favorite:!r.favorite,updatedAt:new Date().toISOString()}:r));};
  const handleUpdateAll=(updatedRecipes)=>{persist(updatedRecipes);};
  const handleCopy=(recipe)=>{
    const copied={...recipe,id:Date.now(),title:recipe.title+" (コピー)",addedBy:userName,addedAt:new Date().toLocaleDateString("ja-JP"),updatedAt:new Date().toISOString(),comments:[],madeCount:0,lastMade:null,favorite:false,photo:null,stepPhotos:{}};
    persist([copied,...recipes]);setToast("📋 コピーしました");setView("home");setSelected(null);
  };
  const handleView=(recipe)=>{
    setSelected(recipe);setView("detail");
    const newR={id:recipe.id,title:recipe.title,emoji:recipe.emoji,viewedAt:Date.now()};
    persistHistory([newR,...history.filter(x=>x.id!==recipe.id)].slice(0,20));
    persist(recipes.map(r=>r.id===recipe.id?{...r,viewCount:(r.viewCount||0)+1,updatedAt:new Date().toISOString()}:r));
  };

  const activeRecipes=useMemo(()=>recipes.filter(r=>!r.deleted),[recipes]);

  const SORT_OPTS=[{id:"date",label:"追加日"},{id:"views",label:"よく見る"},{id:"made",label:"作った回数"},{id:"az",label:"あいうえお"}];
  const sorted=useMemo(()=>{
    let arr=[...activeRecipes];
    if(filterFav)arr=arr.filter(r=>r.favorite);
    if(activeTag)arr=arr.filter(r=>(r.tags||[]).includes(activeTag));
    if(search)arr=arr.filter(r=>r.title?.includes(search)||(r.tags||[]).some(t=>t.includes(search)));
    switch(sortBy){
      case"views":arr.sort((a,b)=>(b.viewCount||0)-(a.viewCount||0));break;
      case"made":arr.sort((a,b)=>(b.madeCount||0)-(a.madeCount||0));break;
      case"az":arr.sort((a,b)=>(a.title||"").localeCompare(b.title||"","ja"));break;
      default:arr.sort((a,b)=>(b.id||0)-(a.id||0));
    }
    return arr;
  },[activeRecipes,filterFav,activeTag,search,sortBy]);

  const allTags=[...new Set(activeRecipes.flatMap(r=>r.tags||[]))];
  const syncIcon=syncStatus==="syncing"?"⏳":syncStatus==="ok"?"✅":syncStatus==="error"?"❌":"🔄";

  if(!authed)return(
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,"+G.dark+",#1a1a2e)",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <style>{CSS}</style>
      <div style={{maxWidth:360,width:"100%",textAlign:"center"}}>
        <div style={{fontSize:64,marginBottom:12}}>🔒</div>
        <div style={{fontFamily:"'Zen Kaku Gothic New',sans-serif",fontSize:24,fontWeight:900,marginBottom:6,background:"linear-gradient(135deg,#e8825a,#c85a8a)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>レシピノート</div>
        <div style={{color:G.sub,fontSize:13,marginBottom:28,lineHeight:1.8}}>パスワードを入力してください</div>
        <input value={pwInput} onChange={e=>{setPwInput(e.target.value);setPwError(false);}} onKeyDown={e=>e.key==="Enter"&&checkPassword()} type="password" placeholder="パスワード" style={{width:"100%",padding:"15px 16px",borderRadius:14,border:"2px solid "+(pwError?"#e85a5a":G.border),background:G.card,color:G.text,fontSize:15,marginBottom:10,display:"block",WebkitAppearance:"none",textAlign:"center",letterSpacing:4}}/>
        {pwError&&<div style={{color:"#e85a5a",fontSize:13,marginBottom:10}}>パスワードが違います</div>}
        <button onClick={checkPassword} style={{width:"100%",padding:"15px",borderRadius:14,border:"none",background:pwInput?"linear-gradient(135deg,#e8825a,#c8603a)":G.input,color:G.text,fontSize:15,fontWeight:700,cursor:pwInput?"pointer":"default",boxShadow:pwInput?"0 6px 20px #e8825a44":"none"}}>入る →</button>
      </div>
    </div>
  );

  if(!userName)return(
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,"+G.dark+",#1a1a2e)",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <style>{CSS}</style>
      <div style={{maxWidth:360,width:"100%",textAlign:"center"}}>
        <div style={{fontSize:72,marginBottom:8}}>🍳</div>
        <div style={{fontFamily:"'Zen Kaku Gothic New',sans-serif",fontSize:28,fontWeight:900,marginBottom:6,background:"linear-gradient(135deg,#e8825a,#c85a8a)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>レシピノート</div>
        <div style={{color:G.sub,fontSize:13,marginBottom:32,lineHeight:1.9}}>2人で共有できるレシピ管理ツール</div>
        <input value={nameInput} onChange={e=>setNameInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&nameInput.trim()){localStorage.setItem("rs-name",nameInput.trim());setUserName(nameInput.trim());}}} placeholder="あなたの名前を入力" style={{width:"100%",padding:"15px 16px",borderRadius:14,border:"2px solid "+G.border,background:G.card,color:G.text,fontSize:15,marginBottom:12,display:"block",WebkitAppearance:"none"}}/>
        <button onClick={()=>{if(nameInput.trim()){localStorage.setItem("rs-name",nameInput.trim());setUserName(nameInput.trim());}}} style={{width:"100%",padding:"15px",borderRadius:14,border:"none",background:nameInput.trim()?"linear-gradient(135deg,#e8825a,#c8603a)":G.input,color:G.text,fontSize:15,fontWeight:700,cursor:nameInput.trim()?"pointer":"default",boxShadow:nameInput.trim()?"0 6px 20px #e8825a44":"none"}}>はじめる →</button>
      </div>
    </div>
  );

  if(view==="add")return <AddScreen onBack={()=>setView("home")} onAdd={handleAdd} userName={userName}/>;

  return(
    <div style={{minHeight:"100vh",background:G.dark}}>
      <style>{CSS}</style>
      {sharedRecipe&&<ImportBanner recipe={sharedRecipe} onImport={()=>{handleAdd({...sharedRecipe,id:Date.now(),addedBy:userName,addedAt:new Date().toLocaleDateString("ja-JP"),comments:[]});setSharedRecipe(null);window.history.replaceState({},"",window.location.pathname);}} onDismiss={()=>{setSharedRecipe(null);window.history.replaceState({},"",window.location.pathname);}}/>}
      {showTagManagement&&<TagManagement recipes={recipes} onUpdateAll={handleUpdateAll} onClose={()=>setShowTagManagement(false)}/>}

      {showHistory&&(
        <div onClick={()=>setShowHistory(false)} style={{position:"fixed",inset:0,background:"#000c",zIndex:900,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:G.card,borderRadius:"24px 24px 0 0",width:"100%",maxWidth:540,padding:"20px 20px 40px",maxHeight:"60vh",overflowY:"auto",border:"2px solid "+G.border}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontWeight:700,color:G.text,fontSize:16}}>🕐 最近見たレシピ</div>
              <button onClick={()=>setShowHistory(false)} style={{background:"none",border:"none",color:G.sub,fontSize:20,cursor:"pointer"}}>✕</button>
            </div>
            {history.length===0?<div style={{textAlign:"center",color:G.sub,padding:"20px 0"}}>履歴がありません</div>:
              history.map(h=>{
                const r=activeRecipes.find(x=>x.id===h.id);if(!r)return null;
                return(
                  <div key={h.id} onClick={()=>{handleView(r);setShowHistory(false);}} style={{display:"flex",alignItems:"center",gap:12,padding:"10px",borderRadius:12,cursor:"pointer",marginBottom:4,background:G.input}}>
                    <div style={{fontSize:28,width:36,textAlign:"center"}}>{r.emoji||"🍽️"}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,fontWeight:700,color:G.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.title}</div>
                      <div style={{fontSize:11,color:G.sub}}>{new Date(h.viewedAt).toLocaleDateString("ja-JP")}</div>
                    </div>
                  </div>
                );
              })
            }
          </div>
        </div>
      )}

      <div style={{background:"linear-gradient(135deg,#13132a,#1e1a2e)",borderBottom:"2px solid "+G.accent+"44",padding:"14px 18px 16px",position:"sticky",top:sharedRecipe?56:0,zIndex:100}}>
        <div style={{maxWidth:740,margin:"0 auto"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div>
              <div style={{fontFamily:"'Zen Kaku Gothic New',sans-serif",fontSize:19,fontWeight:900,letterSpacing:1,background:"linear-gradient(135deg,#e8825a,#c85a8a)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>🍳 レシピノート</div>
              <div style={{color:G.sub,fontSize:10,marginTop:1,display:"flex",alignItems:"center",gap:6}}>
                <span>{userName} • {activeRecipes.length}品</span>
                {members.length>1&&<span style={{color:G.blue}}>{"👥 "+members.join("・")}</span>}
                <span style={{fontSize:11}}>{syncIcon}</span>
              </div>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <button onClick={()=>setShowHistory(true)} style={{background:G.card,border:"1.5px solid "+G.border,borderRadius:10,padding:"8px 10px",color:G.sub,cursor:"pointer",fontSize:16}}>🕐</button>
              <button onClick={()=>setShowTagManagement(true)} style={{background:G.card,border:"1.5px solid "+G.border,borderRadius:10,padding:"8px 10px",color:G.sub,cursor:"pointer",fontSize:16}}>🏷</button>
              <button onClick={()=>syncData(true)} style={{background:G.card,border:"1.5px solid "+G.border,borderRadius:10,padding:"8px 10px",color:syncStatus==="ok"?G.green:syncStatus==="error"?"#e85a5a":G.sub,cursor:"pointer",fontSize:14}}>{syncIcon}</button>
              <button onClick={()=>setView("add")} style={{background:"linear-gradient(135deg,#e8825a,#c8603a)",border:"none",borderRadius:12,padding:"9px 16px",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer",boxShadow:"0 4px 16px #e8825a44"}}>＋</button>
            </div>
          </div>
          <div style={{position:"relative",marginBottom:10}}>
            <span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",fontSize:13,color:G.sub}}>🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="レシピ名・タグで検索" style={{width:"100%",padding:"9px 14px 9px 32px",borderRadius:12,border:"1.5px solid "+G.border,background:G.card,color:G.text,fontSize:13,WebkitAppearance:"none"}}/>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center",overflowX:"auto",paddingBottom:2}}>
            <button onClick={()=>setFilterFav(!filterFav)} style={{background:filterFav?"linear-gradient(135deg,#e8c05a,#c8a03a)":G.card,color:filterFav?"#fff":G.sub,border:"1.5px solid "+(filterFav?G.yellow:G.border),borderRadius:20,padding:"4px 12px",fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>{filterFav?"⭐ お気に入り":"☆ お気に入り"}</button>
            <button onClick={()=>setActiveTag("")} style={{background:!activeTag&&!filterFav?"linear-gradient(135deg,#e8825a,#c8603a)":G.card,color:!activeTag&&!filterFav?"#fff":G.sub,border:"1.5px solid "+(!activeTag&&!filterFav?G.accent:G.border),borderRadius:20,padding:"4px 12px",fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>すべて</button>
            {allTags.map((t,i)=>{const c=tagColor(t);return <button key={i} onClick={()=>setActiveTag(activeTag===t?"":t)} style={{background:activeTag===t?c+"33":G.card,color:activeTag===t?c:G.sub,border:"1.5px solid "+(activeTag===t?c:G.border),borderRadius:20,padding:"4px 12px",fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,transition:"all 0.15s"}}>{t}</button>;})}
            <div style={{marginLeft:"auto",flexShrink:0,position:"relative"}}>
              <button onClick={()=>setSortOpen(!sortOpen)} style={{background:G.card,border:"1.5px solid "+G.border,borderRadius:20,padding:"4px 12px",fontSize:11,fontWeight:700,cursor:"pointer",color:G.sub,whiteSpace:"nowrap"}}>{SORT_OPTS.find(s=>s.id===sortBy)?.label} ▼</button>
              {sortOpen&&(
                <div style={{position:"absolute",right:0,top:"calc(100% + 6px)",background:G.card,border:"1.5px solid "+G.border,borderRadius:12,overflow:"hidden",zIndex:200,minWidth:120,boxShadow:"0 8px 24px #000a"}}>
                  {SORT_OPTS.map(s=>(
                    <button key={s.id} onClick={()=>{setSortBy(s.id);setSortOpen(false);}} style={{width:"100%",padding:"10px 14px",border:"none",background:sortBy===s.id?G.accent+"22":"transparent",color:sortBy===s.id?G.accent:G.text,fontSize:12,fontWeight:sortBy===s.id?700:400,cursor:"pointer",textAlign:"left"}}>{s.label}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{maxWidth:740,margin:"0 auto",padding:"18px 16px 60px"}}>
        {sorted.length===0?(
          <div style={{textAlign:"center",padding:"72px 0"}}>
            <div style={{fontSize:56,marginBottom:16}}>📭</div>
            <div style={{fontWeight:700,marginBottom:8,color:G.sub}}>{search||activeTag||filterFav?"該当するレシピがありません":"まだレシピがありません"}</div>
            <div style={{fontSize:13,lineHeight:1.9,color:"#555"}}>「＋」からスクショ・URL・手書きで取り込もう</div>
          </div>
        ):(
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:14}}>
            {sorted.map(r=><RecipeCard key={r.id} recipe={r} onClick={()=>handleView(r)} onDelete={handleDelete} onToggleFav={handleToggleFav} userName={userName}/>)}
          </div>
        )}
      </div>

      {view==="detail"&&selected&&!selected.deleted&&<RecipeDetail recipe={selected} onClose={()=>{setView("home");setSelected(null);}} onUpdate={handleUpdate} userName={userName} onDelete={(id)=>{handleDelete(id);setView("home");setSelected(null);}} onCopy={handleCopy}/>}
      <Toast msg={toast} onClear={()=>setToast("")}/>
    </div>
  );
}
