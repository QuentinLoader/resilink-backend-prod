import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ResidencyProvider } from "./context/ResCtx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ResidencyProvider>
      <App />
    </ResidencyProvider>
  </React.StrictMode>
);
