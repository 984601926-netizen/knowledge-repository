import React from "react";
import { createRoot } from "react-dom/client";
import App from "./WorldApp";
import "./styles.css";
import "./upgrade.css";
import "./world.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
