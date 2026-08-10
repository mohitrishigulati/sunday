"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/primitives";
import { createClient } from "@/lib/supabase/client";

export function AttachmentLink({ storagePath, fileName }: { storagePath:string; fileName:string }) {
  const [error,setError]=useState<string|null>(null);const[pending,startTransition]=useTransition();
  return <div><Button type="button" variant="ghost" disabled={pending} onClick={()=>startTransition(async()=>{setError(null);const{data,error:signError}=await createClient().storage.from("accounting-attachments").createSignedUrl(storagePath,60,{download:fileName});if(signError||!data){setError(signError?.message??"Could not open attachment");return;}window.open(data.signedUrl,"_blank","noopener,noreferrer");})}>Open file</Button>{error?<p className="text-xs text-[var(--danger)]">{error}</p>:null}</div>;
}
