import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import Workspace from "./Workspace.jsx";

// 경로로 분기합니다. React Router를 추가하지 않고
// 의존성 없이 두 화면을 나눕니다.
const isWorkspace = window.location.pathname.startsWith("/workspace");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isWorkspace ? <Workspace /> : <App />}
  </React.StrictMode>
);