const LIST_URL = "https://api.imagekit.io/v1/files";

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// token+expireをPrivateKeyでHMAC-SHA1 -> 小文字hex(ImageKitクライアント側アップロードの仕様)
async function hmacSha1Hex(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // アップロード用の認証パラメータ発行
    if (url.pathname === "/auth") {
      const token = crypto.randomUUID();
      const expire = Math.floor(Date.now() / 1000) + 40 * 60; // 40分後
      const signature = await hmacSha1Hex(
        env.IMAGEKIT_PRIVATE_KEY,
        token + expire,
      );
      return Response.json({ token, expire, signature }, { headers });
    }

    // 専用フォルダの画像一覧をPrivate Keyで代理取得
    if (url.pathname === "/list") {
      const folder = env.UPLOAD_FOLDER || "/";
      const apiUrl =
        `${LIST_URL}?path=${encodeURIComponent(folder)}` +
        `&sort=DESC_CREATED&limit=100&fileType=image`;
      const auth = btoa(env.IMAGEKIT_PRIVATE_KEY + ":"); // Basic: privateKeyをuser, passwordを空
      const resp = await fetch(apiUrl, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!resp.ok) {
        return Response.json(
          { error: "list failed", status: resp.status },
          { status: 502, headers },
        );
      }
      const files = await resp.json();
      const items = (Array.isArray(files) ? files : []).map((f) => ({
        fileId: f.fileId,
        name: f.name,
        url: f.url,
        thumbnailUrl: f.thumbnail || f.url,
      }));
      return Response.json(items, { headers });
    }

    // 指定 fileId の画像を Private Key で削除
    if (url.pathname === "/delete" && request.method === "POST") {
      let fileId;
      try {
        ({ fileId } = await request.json());
      } catch {
        return Response.json({ error: "invalid body" }, { status: 400, headers });
      }
      if (!fileId) {
        return Response.json({ error: "fileId required" }, { status: 400, headers });
      }
      const auth = btoa(env.IMAGEKIT_PRIVATE_KEY + ":");
      const resp = await fetch(`${LIST_URL}/${encodeURIComponent(fileId)}`, {
        method: "DELETE",
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!resp.ok) {
        return Response.json(
          { error: "delete failed", status: resp.status },
          { status: 502, headers }
        );
      }
      return Response.json({ success: true }, { headers });
    }

    return new Response("Not found", { status: 404, headers });
  },
};
