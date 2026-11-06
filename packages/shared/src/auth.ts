import { z } from "zod";
import { KINGDOM_IDS, type KingdomId } from "./constants";
import { CHARACTER_NAME_PATTERN, type CharacterSummary } from "./characterRules";

/**
 * REST auth/character DTOs shared by the server routes and the client API
 * client. Request schemas are validated on both sides; response types are
 * deliberately plain TypeScript interfaces.
 */

const emailSchema = z.email().max(254);
const passwordSchema = z.string().min(8).max(128);
const loginNameSchema = z.string().trim().min(1).max(254);

export const registerRequestSchema = z.object({
  email: emailSchema,
  username: z.string().trim().min(3).max(16).regex(CHARACTER_NAME_PATTERN),
  password: passwordSchema,
  kingdom: z.enum(KINGDOM_IDS),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  /** Email or username; resolved case-insensitively by the server. */
  login: loginNameSchema,
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1).max(4096),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const logoutRequestSchema = refreshRequestSchema;
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export type AccountRole = "player" | "gm" | "admin";

export interface AccountPublic {
  id: string;
  email: string;
  username: string;
  kingdom: KingdomId;
  role: AccountRole;
}

export interface AuthResponse {
  tokens: AuthTokens;
  account: AccountPublic;
  characters: CharacterSummary[];
}

export interface MeResponse {
  account: AccountPublic;
  characters: CharacterSummary[];
}

export interface CharactersResponse {
  characters: CharacterSummary[];
}

export interface CreateCharacterResponse {
  character: CharacterSummary;
}

export type ApiErrorCode =
  | "validation"
  | "invalid_credentials"
  | "unauthorized"
  | "account_banned"
  | "email_taken"
  | "username_taken"
  | "name_taken"
  | "slots_full"
  | "not_found"
  | "character_online"
  | "rate_limited"
  | "database_unavailable"
  | "internal";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    fields?: Record<string, string>;
  };
}
