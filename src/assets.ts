import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export type Asset = {
  id: string;
  name: string;
  mime: string;
  path: string;
  isDir: boolean;
};

export function isImage(asset: Asset) {
  return asset.mime.startsWith("image/");
}

export function imageResolver(assets: Asset[]) {
  const urls = new Map(assets.map((asset) => [asset.id, convertFileSrc(asset.path)]));
  return (src: string) => (src.startsWith("asset:") ? (urls.get(src.slice(6)) ?? null) : null);
}

export function imageMarkdown(asset: Asset) {
  const alt = asset.name.replace(/\.[^.]+$/, "").replace(/[[\]\n]/g, "");
  return `![${alt}](asset:${asset.id})`;
}

export function withoutAssetLinks(body: string, assetId: string) {
  return body.split(new RegExp(`!\\[[^\\]\\n]*\\]\\(asset:${assetId}\\)\\n?`)).join("");
}

function pastedName(file: File) {
  if (file.name && file.name !== "image.png") return file.name;
  const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `pasted-${stamp}.${extension}`;
}

export async function savePastedImages(documentId: string, files: File[]) {
  const saved: Asset[] = [];
  for (const file of files) {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    saved.push(
      await invoke<Asset>("save_asset", { documentId, name: pastedName(file), bytes }),
    );
  }
  return saved;
}
