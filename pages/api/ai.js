export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } }
};

const RECIPE_SYSTEM = `あなたはレシピ抽出AIです。
画像・URL・テキストからレシピ情報を抽出し、必ずJSON形式のみで返答してください。
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
- nutritionは材料と手順から1人分の栄養素を必ず推定すること（推定値でよい）
- 必ずJSON単体のみを返す`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { prompt, imageBase64, imageMediaType } = req.body;
  try {
    let finalPrompt = prompt;
    if (!imageBase64 && prompt) {
      const urlMatch = prompt.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        try {
          const pageRes = await fetch(urlMatch[0], {
            headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15" },
            redirect: "follow",
          });
          if (pageRes.ok) {
            const html = await pageRes.text();
            const pageContent = html
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 4000);
            if (pageContent.length > 100) {
              finalPrompt = `以下のページ内容からレシピを抽出してください:\nURL: ${urlMatch[0]}\n\n${pageContent}`;
            }
          }
        } catch (e) {}
      }
    }
    const messages = [
      { role: "system", content: RECIPE_SYSTEM },
      {
        role: "user",
        content: imageBase64
          ? [
              { type: "image_url", image_url: { url: `data:${imageMediaType};base64,${imageBase64}` } },
              { type: "text", text: finalPrompt },
            ]
          : finalPrompt,
      },
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
    return res.status(200).json({ content: data.choices?.[0]?.message?.content || "" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
