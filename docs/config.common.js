// 全店舗共通の設定（公開可能な値のみ）
// 各店舗ページでは、このファイルの後に店舗別 config.js を読み込み、
// STORE_NAME / UPLOAD_FOLDER を上書き（追記）する。
window.APP_CONFIG = {
  // wrangler deploy後に表示される*.workers.devのURL
  WORKER_BASE_URL: "https://imageuploader-worker.mkw-uploader.workers.dev",
  // ImageKit ダッシュボード > Developer options
  IMAGEKIT_PUBLIC_KEY: "public_4UnoVn7mjbI6kM8XHEQ+K8UPznI=",
  IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/mkw",
};
