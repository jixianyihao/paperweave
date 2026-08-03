import { render, screen } from "@testing-library/react";
import ReaderPage from "./ReaderPage";

test("embeds zotero reader pointing at the sample pdf", () => {
  render(<ReaderPage />);
  const frame = screen.getByTitle("reader");
  const src = frame.getAttribute("src") ?? "";
  expect(src).toContain("reader.html");
  expect(src).toContain("sample.pdf");
});
