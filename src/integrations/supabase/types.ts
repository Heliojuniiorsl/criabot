export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      bot_settings: {
        Row: {
          created_at: string;
          id: string;
          menu_buttons: Json;
          payment_info: string | null;
          private_group_link: string | null;
          support_link: string | null;
          terms_text: string;
          updated_at: string;
          welcome_image_url: string | null;
          welcome_message: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          menu_buttons?: Json;
          payment_info?: string | null;
          private_group_link?: string | null;
          support_link?: string | null;
          terms_text?: string;
          updated_at?: string;
          welcome_image_url?: string | null;
          welcome_message?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          menu_buttons?: Json;
          payment_info?: string | null;
          private_group_link?: string | null;
          support_link?: string | null;
          terms_text?: string;
          updated_at?: string;
          welcome_image_url?: string | null;
          welcome_message?: string;
        };
        Relationships: [];
      };
      broadcasts: {
        Row: {
          buttons: Json;
          created_at: string;
          id: string;
          image_url: string | null;
          interval_hours: number;
          is_active: boolean;
          last_sent_at: string | null;
          locked_at: string | null;
          message: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          buttons?: Json;
          created_at?: string;
          id?: string;
          image_url?: string | null;
          interval_hours?: number;
          is_active?: boolean;
          last_sent_at?: string | null;
          locked_at?: string | null;
          message: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          buttons?: Json;
          created_at?: string;
          id?: string;
          image_url?: string | null;
          interval_hours?: number;
          is_active?: boolean;
          last_sent_at?: string | null;
          locked_at?: string | null;
          message?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      contents: {
        Row: {
          created_at: string;
          description: string | null;
          file_url: string | null;
          id: string;
          is_active: boolean;
          price: number;
          preview_url: string | null;
          title: string;
          type: Database["public"]["Enums"]["content_type"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          file_url?: string | null;
          id?: string;
          is_active?: boolean;
          price?: number;
          preview_url?: string | null;
          title: string;
          type?: Database["public"]["Enums"]["content_type"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          file_url?: string | null;
          id?: string;
          is_active?: boolean;
          price?: number;
          preview_url?: string | null;
          title?: string;
          type?: Database["public"]["Enums"]["content_type"];
          updated_at?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          amount: number;
          content_id: string | null;
          created_at: string;
          delivery_claimed_at: string | null;
          delivery_sent_at: string | null;
          fulfilled_at: string | null;
          id: string;
          plan_id: string | null;
          status: Database["public"]["Enums"]["order_status"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          amount?: number;
          content_id?: string | null;
          created_at?: string;
          delivery_claimed_at?: string | null;
          delivery_sent_at?: string | null;
          fulfilled_at?: string | null;
          id?: string;
          plan_id?: string | null;
          status?: Database["public"]["Enums"]["order_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          amount?: number;
          content_id?: string | null;
          created_at?: string;
          delivery_claimed_at?: string | null;
          delivery_sent_at?: string | null;
          fulfilled_at?: string | null;
          id?: string;
          plan_id?: string | null;
          status?: Database["public"]["Enums"]["order_status"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_content_id_fkey";
            columns: ["content_id"];
            isOneToOne: false;
            referencedRelation: "contents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          created_at: string;
          id: string;
          amount: number | null;
          order_id: string;
          paid_at: string | null;
          payment_url: string | null;
          provider_payment_id: string | null;
          provider_preference_id: string | null;
          raw_status: string | null;
          provider: string;
          status: Database["public"]["Enums"]["payment_status"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          amount?: number | null;
          order_id: string;
          paid_at?: string | null;
          payment_url?: string | null;
          provider_payment_id?: string | null;
          provider_preference_id?: string | null;
          raw_status?: string | null;
          provider?: string;
          status?: Database["public"]["Enums"]["payment_status"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          amount?: number | null;
          order_id?: string;
          paid_at?: string | null;
          payment_url?: string | null;
          provider_payment_id?: string | null;
          provider_preference_id?: string | null;
          raw_status?: string | null;
          provider?: string;
          status?: Database["public"]["Enums"]["payment_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      plans: {
        Row: {
          created_at: string;
          description: string | null;
          duration_days: number;
          id: string;
          is_active: boolean;
          name: string;
          price: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          duration_days?: number;
          id?: string;
          is_active?: boolean;
          name: string;
          price?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          duration_days?: number;
          id?: string;
          is_active?: boolean;
          name?: string;
          price?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          created_at: string;
          end_date: string;
          id: string;
          plan_id: string | null;
          start_date: string;
          status: Database["public"]["Enums"]["subscription_status"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          end_date: string;
          id?: string;
          plan_id?: string | null;
          start_date?: string;
          status?: Database["public"]["Enums"]["subscription_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          end_date?: string;
          id?: string;
          plan_id?: string | null;
          start_date?: string;
          status?: Database["public"]["Enums"]["subscription_status"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      users: {
        Row: {
          created_at: string;
          id: string;
          is_adult_confirmed: boolean;
          name: string | null;
          telegram_id: number;
          telegram_username: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_adult_confirmed?: boolean;
          name?: string | null;
          telegram_id: number;
          telegram_username?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_adult_confirmed?: boolean;
          name?: string | null;
          telegram_id?: number;
          telegram_username?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      app_role: "admin" | "user";
      content_type: "foto" | "video" | "pacote";
      order_status: "pending" | "paid" | "canceled" | "expired";
      payment_status: "pending" | "paid" | "canceled" | "expired";
      subscription_status: "active" | "expired" | "canceled";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      content_type: ["foto", "video", "pacote"],
      order_status: ["pending", "paid", "canceled", "expired"],
      payment_status: ["pending", "paid", "canceled", "expired"],
      subscription_status: ["active", "expired", "canceled"],
    },
  },
} as const;
