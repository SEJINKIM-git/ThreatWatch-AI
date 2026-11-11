import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import Workspace from "./Workspace.jsx";
import DepegPage from "./depeg/DepegPage.jsx";

// 경로로 분기합니다. React Router를 추가하지 않고
// 의존성 없이 화면을 나눕니다.
const path = window.location.pathname;

function Screen() {
  if (path.startsWith("/workspace")) return <Workspace />;
  if (path.startsWith("/depeg")) return <DepegPage />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Screen />
  </React.StrictMode>
);