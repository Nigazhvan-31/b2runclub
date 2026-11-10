import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./components/ui";
import { AuthProvider } from "./lib/auth";
import { BranchProvider } from "./lib/branch";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <BranchProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </BranchProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
