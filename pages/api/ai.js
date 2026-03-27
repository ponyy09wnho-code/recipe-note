export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } }
};

const RECIPE_SYSTEM = `あなたはレシピ抽出AIです。
提供されたページ内容・画像・テキストからレシピ情報を抽出し、必ずJSON形式のみで返答してください。
コードブロック・前置きテキスト・説明文は一切不要です。JSONのみ出力してください。

フォーマット:
{"title":"料理名","description":"一言説明20字以内","tags":["タグ1","タグ2"],"servings":"〇人分","time":"〇分","ingredients":[{"name":"材料名","amount":"分量"}],"steps":["手順1","手順2"],"tips":"コツ・注意点（あれば）またはnull","source":"取得元サービス名","sourceUrl":null,"emoji":"絵文字1つ","nutrition":{"calories":数字,"protein":数字,"fat":数字,"carbs":数字,"fiber":数字}}

tagsのルール:
- 料理のジャンル（和食・洋食・中華など）を1つ入れる
- 調理特徴（簡単・時短・作り置きなど）を必要に応じて入れる
- 使用している主要食材を全て個別にタグとして入れる（例：鶏肉、ブロッコリー、卵、豆腐）
- 以下の調味料・基本調味料はタグに含めない：塩、砂糖、醤油、みりん、酒、酢、味噌、油、サラダ油、ごま油、オリーブオイル、バター、こしょう、片栗粉、小麦粉、だし、めんつゆ、ケチャップ、マヨネーズ、ソース、塩こしょう、水
- tagsは合計3〜8個
- 情報不明の項目はnullまたは空配列
- sourceUrlはURLが明示されている場合のみ文字列で入れる
- tipsはコツや注意点があれば文字列で、なければnull
- nutritionは材料と手順から1人分の栄養素を推定すること（推定値でよい）

【絶対厳守】
- 提供されたページ内容・データに含まれる情報のみを使うこと
- ページ内容からレシピが読み取れない場合は {"error":"レシピ情報が見つかりませんでした"} のみを返すこと
- 存在しない・確認できないレシピを絶対に作らないこと
- 必ずJSON単体のみを返す`;

/** <script type="application/ld+json"> からRecipeスキーマを抽出 */
function extractJsonLd(html) {
  try {
    const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    for (const m of html.matchAll(re)) {
      let data;
      try { data = JSON.parse(m[1]); } catch { continue; }
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const types = [item["@type"]].flat();
        if (types.includes("Recipe")) {
          return JSON.stringify(item, null, 2).slice(0, 6000);
        }
        // @graph 形式
        if (item["@graph"]) {
          for (const g of item["@graph"]) {
            if ([g["@type"]].flat().includes("Recipe")) {
              return JSON.stringify(g, null, 2).slice(0, 6000);
            }
          }
        }
      }
    }
  } catch {}
  return null;
}

/** HTMLからスクリプト・スタイルを除去してテキストを抽出 */
function extractText(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 抽出テキストがレシピらしい内容かを判定 */
function looksLikeRecipe(text) {
  const keywords = ["材料", "作り方", "手順", "レシピ", "分量", "大さじ", "小さじ", "g ", "ml", "カップ", "個", "本", "枚", "切る", "炒める", "煮る", "焼く", "混ぜる", "加える"];
  const count = keywords.filter(k => text.includes(k)).length;
  return count >= 2;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { prompt, imageBase64, imageMediaType } = req.body;

  try {
    let finalPrompt = prompt;

    // URL入力の場合はページコンテンツを取得
    if (!imageBase64 && prompt) {
      const urlMatch = prompt.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        const url = urlMatch[0];
        let pagePrompt = null;
        let fetchError = "URLのページを読み込めませんでした";

        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 9000);

          const pageRes = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "ja,ja-JP;q=0.9,en;q=0.8",
              "Accept-Encoding": "gzip, deflate",
            },
            redirect: "follow",
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (!pageRes.ok) {
            fetchError = `ページを取得できませんでした（HTTP ${pageRes.status}）。スクショを使うか、レシピのテキストを直接貼り付けてください。`;
          } else {
            const html = await pageRes.text();

            // 1. JSON-LDのRecipeスキーマを優先取得（最も信頼性が高い）
            const jsonLd = extractJsonLd(html);
            if (jsonLd) {
              pagePrompt = `以下のRecipe構造化データ（JSON-LD）からレシピを抽出してください:\nURL: ${url}\n\n${jsonLd}`;
            } else {
              // 2. テキスト抽出にフォールバック
              const text = extractText(html);
              if (text.length >= 400 && looksLikeRecipe(text)) {
                pagePrompt = `以下のページ内容からレシピを抽出してください:\nURL: ${url}\n\n${text.slice(0, 5000)}`;
              } else if (text.length < 400) {
                fetchError = "このページはJavaScript動的レンダリングのため内容を読み込めませんでした。スクショを使うか、レシピのテキストを直接貼り付けてください。";
              } else {
                fetchError = "このページからレシピ情報を見つけられませんでした。レシピページのURLか、スクショを使ってください。";
              }
            }
          }
        } catch (e) {
          if (e.name === "AbortError") {
            fetchError = "ページの読み込みがタイムアウトしました。スクショを使うか、テキストを直接貼り付けてください。";
          } else {
            fetchError = "ページの取得中にエラーが発生しました。スクショを使うか、テキストを直接貼り付けてください。";
          }
        }

        // コンテンツが取れなかった場合は AIを呼ばずに即エラー返却
        if (!pagePrompt) {
          return res.status(422).json({ error: fetchError });
        }

        finalPrompt = pagePrompt;
      }
    }

    // 複数画像対応: imagesBase64 配列があればそちらを使う
    const { imagesBase64 } = req.body;
    let userContent;
    if (imagesBase64 && imagesBase64.length > 0) {
      userContent = [
        ...imagesBase64.map(img => ({
          type: "image_url",
          image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
        })),
        { type: "text", text: finalPrompt },
      ];
    } else if (imageBase64) {
      userContent = [
        { type: "image_url", image_url: { url: `data:${imageMediaType};base64,${imageBase64}` } },
        { type: "text", text: finalPrompt },
      ];
    } else {
      userContent = finalPrompt;
    }

    const messages = [
      { role: "system", content: RECIPE_SYSTEM },
      { role: "user", content: userContent },
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.OPENAI_API_KEY },
      body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 1800, messages }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err?.error?.message || "OpenAI error: " + response.status);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // AIが「レシピ見つからない」エラーを返した場合
    try {
      const parsed = JSON.parse(content.trim());
      if (parsed?.error) {
        return res.status(422).json({ error: parsed.error + "。スクショを使うか、テキストを直接貼り付けてください。" });
      }
    } catch {}

    return res.status(200).json({ content });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
