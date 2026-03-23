const RECIPE_SYSTEM = `あなたはレシピ抽出AIです。
画像・URL・テキストからレシピ情報を抽出し、必ずJSON形式のみで返答してください。
コードブロック・前置きテキスト・説明文は一切不要です。JSONのみ出力してください。

フォーマット:
{"title":"料理名","description":"一言説明20字以内","tags":["ジャンル","食材","特徴","難易度"],"servings":"〇人分","time":"〇分","ingredients":[{"name":"材料名","amount":"分量"}],"steps":["手順1","手順2"],"source":"取得元サービス名","sourceUrl":null,"emoji":"絵文字1つ"}

ルール:
- tagsは必ず3〜5個
- 情報不明の項目はnullまたは空配列
- sourceUrlはURLが明示されている場合のみ文字列で入れる
- 必ずJSON単体のみを返す`;

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt, imageBase64, imageMediaType } = req.body;

  try {
    const userContent = imageBase64
      ? [
          { type: "image", source: { type: "base64", media_type: imageMediaType, data: imageBase64 } },
          { type: "text", text: prompt },
        ]
      : [{ type: "text", text: prompt }];

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        system: RECIPE_SYSTEM,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err?.error?.message || `Anthropic error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.content?.map((b) => b.text || "").join("") || "";
    return res.status(200).json({ content });

  } catch (error) {
    console.error("AI API Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
