import { createContext, useContext } from "react";

export type ManagedBotPanel = {
  key: string;
  kind: "sales" | "images";
  is_custom: boolean;
  display_name: string;
  username: string;
  photo_data_url: string | null;
};

export const ManagedBotContext = createContext<ManagedBotPanel | null>(null);

export function useManagedBotPanel() {
  const bot = useContext(ManagedBotContext);
  if (!bot) throw new Error("Painel do bot não foi carregado");
  return bot;
}
