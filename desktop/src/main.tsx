import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createHashHistory, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { applyDocumentTheme, readBootTheme } from "./lib/document-theme";
import { getRouter } from "./router";
import "./index.css";

applyDocumentTheme(readBootTheme());

const queryClient = new QueryClient();
const history = createHashHistory();
const router = getRouter(history);

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
