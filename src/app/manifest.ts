import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CriaBot",
    short_name: "CriaBot",
    description: "Crie e administre sua operação de bots.",
    start_url: "/",
    display: "standalone",
    background_color: "#08080b",
    theme_color: "#08080b",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/criabot-mark.png",
        sizes: "1024x1024",
        type: "image/png",
      },
    ],
  };
}
