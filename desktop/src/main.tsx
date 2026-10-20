import { QueryClientProvider } from "@tanstack/react-query";
import { createHashHistory, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { applyDocumentTheme, readBootTheme } from "./lib/document-theme";
import { createAppQueryClient } from "./lib/query-client";
import { getRouter } from "./router";
import "./index.css";

applyDocumentTheme(readBootTheme());

const queryClient = createAppQueryClient();
const history = createHashHistory();
const router = getRouter(history);

async function bootstrap() {
  if (import.meta.env.MODE === "mock") {
    const { installMockIpc } = await import("~/test/mock-ipc");
    installMockIpc();
  }

  const root = document.getElementById("root");
  if (root) {
    createRoot(root).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </StrictMode>,
    );
  }
}

void bootstrap();
