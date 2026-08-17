import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import Root from "./components/Root";
import LibraryPage from "./pages/LibraryPage";
import SettingsPage from "./pages/SettingsPage";
import ReaderPage from "./ReaderPage";
import "./stores/themeStore"; // 尽早应用持久化主题，避免闪烁
import "./index.css";

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: "/", element: <LibraryPage /> },
      { path: "/read/:itemId", element: <ReaderPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "/settings/:section", element: <SettingsPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
