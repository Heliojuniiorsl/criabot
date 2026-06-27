export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          phone: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          phone?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          display_name?: string;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      bots: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          handle: string;
          description: string;
          personality: string;
          tone: string;
          platform: string;
          status: Database["public"]["Enums"]["bot_status"];
          watermark_enabled: boolean;
          configuration: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          handle: string;
          description?: string;
          personality?: string;
          tone?: string;
          platform?: string;
          status?: Database["public"]["Enums"]["bot_status"];
          watermark_enabled?: boolean;
          configuration?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          handle?: string;
          description?: string;
          personality?: string;
          tone?: string;
          platform?: string;
          status?: Database["public"]["Enums"]["bot_status"];
          watermark_enabled?: boolean;
          configuration?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      bot_metrics_daily: {
        Row: {
          bot_id: string;
          metric_date: string;
          messages_count: number;
          audience_count: number;
          blocked_requests_count: number;
        };
        Insert: {
          bot_id: string;
          metric_date?: string;
          messages_count?: number;
          audience_count?: number;
          blocked_requests_count?: number;
        };
        Update: {
          messages_count?: number;
          audience_count?: number;
          blocked_requests_count?: number;
        };
        Relationships: [];
      };
      bot_integrations: {
        Row: {
          id: string;
          bot_id: string;
          provider: string;
          status: string;
          external_id: string | null;
          external_name: string | null;
          external_username: string | null;
          credentials_reference: string | null;
          webhook_url: string | null;
          webhook_registered_at: string | null;
          error_message: string | null;
          metadata: Json;
          last_checked_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          bot_id: string;
          provider: string;
          status?: string;
          external_id?: string | null;
          external_name?: string | null;
          external_username?: string | null;
          credentials_reference?: string | null;
          webhook_url?: string | null;
          webhook_registered_at?: string | null;
          error_message?: string | null;
          metadata?: Json;
          last_checked_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: string;
          external_id?: string | null;
          external_name?: string | null;
          external_username?: string | null;
          credentials_reference?: string | null;
          webhook_url?: string | null;
          webhook_registered_at?: string | null;
          error_message?: string | null;
          metadata?: Json;
          last_checked_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      bot_integration_secrets: {
        Row: {
          id: string;
          integration_id: string;
          owner_id: string;
          provider: string;
          secret_token: string;
          secret_hint: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          integration_id: string;
          owner_id: string;
          provider: string;
          secret_token: string;
          secret_hint: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          secret_token?: string;
          secret_hint?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: number;
          owner_id: string;
          bot_id: string | null;
          action: string;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: never;
          owner_id: string;
          bot_id?: string | null;
          action: string;
          metadata?: Json;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      bot_status: "draft" | "active" | "paused" | "archived";
    };
    CompositeTypes: Record<string, never>;
  };
};
