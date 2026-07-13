import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/docs/api")({
  head: () => ({
    meta: [
      { title: "Medical Calling AI - REST API Reference" },
      {
        name: "description",
        content:
          "Interactive OpenAPI reference for Medical Calling AI: agents, contacts, campaigns, calls, automations, and Twilio webhooks.",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: "https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css",
      },
    ],
  }),
  component: ApiDocs,
});

function ApiDocs() {
  useEffect(() => {
    const s = document.createElement("script");
    s.src = "https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js";
    s.crossOrigin = "anonymous";
    s.onload = () => {
      // @ts-expect-error injected UMD
      window.SwaggerUIBundle({
        url: "/api/openapi.json",
        dom_id: "#swagger",
        deepLinking: true,
        docExpansion: "list",
        tryItOutEnabled: true,
      });
    };
    document.body.appendChild(s);
    return () => {
      s.remove();
    };
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <div className="border-b border-neutral-200 bg-neutral-950 px-6 py-4 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-emerald-400">
              Medical Calling AI
            </div>
            <h1 className="text-lg font-semibold">REST API Reference</h1>
          </div>
          <a
            href="/api/openapi.json"
            className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 font-mono text-xs text-emerald-300 hover:bg-emerald-500/20"
          >
            openapi.json
          </a>
        </div>
      </div>
      <div id="swagger" className="mx-auto max-w-7xl" />
    </div>
  );
}
