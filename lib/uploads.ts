"use client";

// Browser-side helper for uploading a game/tool build zip directly to
// Supabase Storage via a server-minted signed upload URL (lib/assets.ts's
// uploadAsset() uses the anon client directly since creator-assets has an
// open storage.objects policy; game-builds does not, so this goes through
// app/api/uploads/games/sign instead — see 0013's migration comment).
//
// Uses raw XMLHttpRequest instead of fetch/the Supabase SDK's
// uploadToSignedUrl() specifically to get real upload progress — fetch has
// no upload-progress event, and the SDK helper doesn't expose one either.

export type UploadProgress = { loaded: number; total: number; pct: number };

async function signUpload(fileName: string, fileSizeBytes: number): Promise<{ path: string; signedUrl: string }> {
  const res = await fetch("/api/uploads/games/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, fileSizeBytes }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to get an upload URL (${res.status})`);
  }
  return res.json();
}

function putWithProgress(url: string, file: File, onProgress?: (p: UploadProgress) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", "application/zip");
    xhr.upload.onprogress = (e) => {
      if (!onProgress || !e.lengthComputable) return;
      onProgress({ loaded: e.loaded, total: e.total, pct: e.total > 0 ? e.loaded / e.total : 0 });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed — network error"));
    xhr.send(file);
  });
}

/** Uploads a zip file to Storage, returning the storage path for the follow-up process call. */
export async function uploadGameBuildZip(
  file: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<{ storagePath: string }> {
  const { path, signedUrl } = await signUpload(file.name, file.size);
  await putWithProgress(signedUrl, file, onProgress);
  return { storagePath: path };
}

/** Streams an NDJSON POST response (app/api/uploads/games/process and similar routes), calling onEvent for each line. */
export async function streamNdjson(
  url: string,
  body: unknown,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error ?? `Request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line));
      } catch {
        // ignore malformed lines
      }
    }
  }
  if (buffer.trim()) {
    try {
      onEvent(JSON.parse(buffer));
    } catch {
      // ignore
    }
  }
}
