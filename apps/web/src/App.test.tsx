import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders library shell with nav entries", () => {
  render(<App />);
  expect(screen.getByText("全部文献")).toBeInTheDocument();
  expect(screen.getByText("待读")).toBeInTheDocument();
  expect(screen.getByText("收藏")).toBeInTheDocument();
});
