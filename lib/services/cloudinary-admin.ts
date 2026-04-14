import "server-only";

import { createHash } from "node:crypto";

function getCloudinaryConfig() {
  const cloudName =
    process.env.CLOUDINARY_CLOUD_NAME ||
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ||
    "";
  const apiKey = process.env.CLOUDINARY_API_KEY || "";
  const apiSecret = process.env.CLOUDINARY_API_SECRET || "";

  return {
    cloudName: cloudName.trim(),
    apiKey: apiKey.trim(),
    apiSecret: apiSecret.trim(),
  };
}

export function canDeleteCloudinaryAssets() {
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  return Boolean(cloudName && apiKey && apiSecret);
}

export function extractCloudinaryPublicId(url: string): string | null {
  const raw = String(url || "").trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (!parsed.hostname.includes("cloudinary.com")) return null;

    const parts = parsed.pathname.split("/").filter(Boolean);
    const uploadIdx = parts.findIndex((part) => part === "upload");
    if (uploadIdx === -1) return null;

    let assetParts = parts.slice(uploadIdx + 1);
    if (!assetParts.length) return null;

    while (assetParts.length) {
      const head = assetParts[0] || "";
      if (/^v\d+$/.test(head)) {
        assetParts = assetParts.slice(1);
        break;
      }
      if (
        head.includes(",") ||
        head.startsWith("c_") ||
        head.startsWith("f_") ||
        head.startsWith("q_") ||
        head.startsWith("w_") ||
        head.startsWith("h_") ||
        head.startsWith("g_")
      ) {
        assetParts = assetParts.slice(1);
        continue;
      }
      break;
    }

    if (!assetParts.length) return null;

    const last = assetParts[assetParts.length - 1] || "";
    assetParts[assetParts.length - 1] = last.replace(/\.[a-z0-9]+$/i, "");

    const publicId = assetParts.join("/").trim();
    return publicId || null;
  } catch {
    return null;
  }
}

export async function deleteCloudinaryAssetByUrl(url: string) {
  const publicId = extractCloudinaryPublicId(url);
  if (!publicId) {
    return { success: false, skipped: true, reason: "invalid_url" as const };
  }

  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  if (!cloudName || !apiKey || !apiSecret) {
    return { success: false, skipped: true, reason: "missing_credentials" as const };
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `invalidate=true&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
  const signature = createHash("sha1").update(payload).digest("hex");

  const body = new URLSearchParams({
    public_id: publicId,
    api_key: apiKey,
    timestamp: String(timestamp),
    signature,
    invalidate: "true",
  });

  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
      method: "POST",
      body,
    });

    const data = (await res.json().catch(() => ({}))) as {
      result?: string;
      error?: { message?: string };
    };

    if (!res.ok || data?.error) {
      return {
        success: false,
        skipped: false,
        reason: "api_error" as const,
        error: String(data?.error?.message || `Cloudinary delete failed for ${publicId}`),
      };
    }

    return {
      success: data?.result === "ok" || data?.result === "not found",
      skipped: false,
      reason: data?.result === "not found" ? ("not_found" as const) : ("deleted" as const),
      publicId,
    };
  } catch (error) {
    return {
      success: false,
      skipped: false,
      reason: "request_failed" as const,
      error: error instanceof Error ? error.message : "Cloudinary delete failed",
    };
  }
}
