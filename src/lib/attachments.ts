"use client";

import { createClient } from "@/lib/supabase/client";

export type UploadedAttachment = {
  storagePath: string;
  fileName: string;
  mimeType?: string;
  fileHash: string;
};

async function fileSha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function uploadAccountingAttachment(companyId: string, file: File, category: "documents" | "bank-statements" = "documents"): Promise<UploadedAttachment> {
  if (!companyId) throw new Error("Select a company before uploading a file");
  if (file.size > 20 * 1024 * 1024) throw new Error("Attachment must be 20 MB or smaller");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "attachment";
  const storagePath = `${companyId}/${category}/${crypto.randomUUID()}-${safeName}`;
  const supabase = createClient();
  const { error } = await supabase.storage
    .from("accounting-attachments")
    .upload(storagePath, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error(error.message);
  return { storagePath, fileName: file.name, mimeType: file.type || undefined, fileHash: await fileSha256(file) };
}

export async function removeAccountingAttachment(storagePath: string) {
  await createClient().storage.from("accounting-attachments").remove([storagePath]);
}
