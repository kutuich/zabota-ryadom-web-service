import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App, isVisualAuditPath, VisualAuditRoutes, visualAuditRoutesEnabled } from "./App";
import { AuthProvider } from "./context/AuthContext";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      {visualAuditRoutesEnabled && isVisualAuditPath(window.location.pathname) ? (
        <VisualAuditRoutes />
      ) : (
        <AuthProvider>
          <App />
        </AuthProvider>
      )}
    </BrowserRouter>
  </React.StrictMode>
);
