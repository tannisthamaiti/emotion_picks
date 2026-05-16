import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "../landmark_picker.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
