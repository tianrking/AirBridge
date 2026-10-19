import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./product.css";
import "./theme.css";
import { readLanguage, applyLanguage } from "./i18n";
import { readTheme, resolveTheme, applyTheme, themeQuery } from "./appearance";
applyLanguage(readLanguage());
applyTheme(resolveTheme(readTheme(), matchMedia(themeQuery).matches));
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
