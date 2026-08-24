import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fin Nest",
    short_name: "Fin Nest",
    description: "个人与家庭记账 Web 应用",
    start_url: "/",
    display: "standalone",
    background_color: "#ededec",
    theme_color: "#ededec",
    orientation: "portrait",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
