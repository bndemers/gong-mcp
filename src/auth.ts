// Stytch OAuth 2.1 + email-domain gate for an MCP server.
//
// Verifies the bearer token against Stytch (introspectTokenLocal), looks up
// the user's email via users.get (Stytch tokens don't include email by
// default), caches the mapping, and allows only emails whose domain matches
// AUTH_ALLOWED_EMAIL_DOMAIN. Meant to be copy-pasted into sibling MCP
// repos as-is — no server-specific logic lives here.
//
// Multi-MCP note: Stytch tokens have aud=project_id, so two MCPs sharing a
// Stytch project accept each other's tokens. To isolate them, add per-MCP
// OAuth scopes and validate claims.scope here.

import { Client } from "stytch";

export interface AuthOk {
  ok: true;
  user: string;
}

export interface AuthFail {
  ok: false;
  reason:
    | "no_token"
    | "invalid_token"
    | "no_email"
    | "email_domain_not_allowed";
}

export type AuthResult = AuthOk | AuthFail;

export interface AuthConfig {
  projectId: string;
  projectSecret: string;
  projectDomain: string;
  allowedEmailDomain: string;
}

const EMAIL_CACHE_TTL_MS = 5 * 60 * 1000;

export function createAuthenticator(config: AuthConfig) {
  const client = new Client({
    project_id: config.projectId,
    secret: config.projectSecret,
    custom_base_url: config.projectDomain,
  });

  const allowedDomain = config.allowedEmailDomain.toLowerCase();
  const emailCache = new Map<string, { email: string; expiresAt: number }>();

  const emailForSubject = async (subject: string): Promise<string | null> => {
    const cached = emailCache.get(subject);
    if (cached && cached.expiresAt > Date.now()) return cached.email;

    try {
      const response = await client.users.get({ user_id: subject });
      const verified = response.emails.find((e) => e.verified);
      const email = verified?.email ?? response.emails[0]?.email ?? null;
      if (email) {
        emailCache.set(subject, {
          email,
          expiresAt: Date.now() + EMAIL_CACHE_TTL_MS,
        });
      }
      return email;
    } catch {
      return null;
    }
  };

  return async function authenticate(bearer: string): Promise<AuthResult> {
    if (!bearer) return { ok: false, reason: "no_token" };

    try {
      const claims = await client.idp.introspectTokenLocal(bearer);
      const email = await emailForSubject(claims.subject);
      if (!email) return { ok: false, reason: "no_email" };

      const domain = email.toLowerCase().split("@").at(-1);
      if (domain !== allowedDomain) {
        return { ok: false, reason: "email_domain_not_allowed" };
      }

      return { ok: true, user: email };
    } catch {
      return { ok: false, reason: "invalid_token" };
    }
  };
}
