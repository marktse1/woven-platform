-- Bring-your-own-key (BYOK) storage for the in-browser AI code editor
-- (Part 9). Lets a creator use their own Anthropic/OpenAI/Google API key
-- for their own AI editor sessions instead of the platform's shared key —
-- otherwise every creator's AI usage bills to Woven's own account.
--
-- Same RLS shape as staff_roles (0012): no client-side policy at all. A
-- third-party API key is at least as sensitive as staff role assignment —
-- only the service-role client (via app/api/settings/ai-keys/route.ts,
-- itself gated by Clerk auth()) can read or write this table. The
-- encrypted_key column is never decrypted anywhere except inside the
-- server-side chat route right before calling that provider's API — see
-- lib/keys/encryption.ts.

create table if not exists public.creator_api_keys (
  id             uuid primary key default gen_random_uuid(),
  clerk_user_id  text not null,
  provider       text not null, -- anthropic | openai | google
  encrypted_key  text not null, -- AES-256-GCM ciphertext, see lib/keys/encryption.ts
  key_hint       text not null, -- last 4 chars, for display only ("...a1b2")
  model          text,          -- optional override, e.g. "gpt-4o" or "gemini-2.0-flash"
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists creator_api_keys_owner_provider_idx on public.creator_api_keys (clerk_user_id, provider);

alter table public.creator_api_keys enable row level security;
-- No policy created on purpose — see header comment.
