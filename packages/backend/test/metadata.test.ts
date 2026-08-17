import { describe, it, expect } from "vitest";
import { fetchByDoi, fetchByArxiv, fetchByUrl } from "../src/lib/metadata.js";

const crossrefJson = {
  message: {
    title: ["Attention Is All You Need"],
    author: [{ given: "Ashish", family: "Vaswani" }, { given: "Noam", family: "Shazeer" }],
    issued: { "date-parts": [[2017]] },
    "container-title": ["NeurIPS"],
    DOI: "10.48550/arXiv.1706.03762",
    abstract: "<jats:p>We propose the Transformer…</jats:p>",
    URL: "https://doi.org/10.48550/arXiv.1706.03762",
  },
};

const arxivXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v5</id>
    <title>Attention Is All You Need</title>
    <published>2017-06-12T17:57:34Z</published>
    <summary>Dominant sequence transduction models…</summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
  </entry>
</feed>`;

const pageHtml = `<html><head>
<meta name="citation_title" content="Some Paper">
<meta name="citation_author" content="Doe, Jane">
<meta name="citation_author" content="Smith, John">
<meta name="citation_publication_date" content="2021">
<meta name="citation_journal_title" content="Nature">
<meta name="citation_doi" content="10.1000/xyz123">
<meta name="citation_pdf_url" content="https://example.com/paper.pdf">
</head><body></body></html>`;

function fakeFetch(body: unknown, ok = true, status = 200) {
  return (async () => ({
    ok, status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    arrayBuffer: async () => new TextEncoder().encode(typeof body === "string" ? body : "").buffer,
  })) as unknown as typeof fetch;
}

describe("fetchByDoi", () => {
  it("maps crossref json to PaperMeta", async () => {
    const meta = await fetchByDoi("10.48550/arXiv.1706.03762", fakeFetch(crossrefJson));
    expect(meta?.title).toBe("Attention Is All You Need");
    expect(meta?.creators).toEqual(["Ashish Vaswani", "Noam Shazeer"]);
    expect(meta?.year).toBe(2017);
    expect(meta?.venue).toBe("NeurIPS");
    expect(meta?.abstract).toBe("We propose the Transformer…");
  });

  it("returns null on http error", async () => {
    expect(await fetchByDoi("10.1/x", fakeFetch({}, false, 404))).toBeNull();
  });

  it("returns null on network throw", async () => {
    const boom = (async () => { throw new Error("network"); }) as unknown as typeof fetch;
    expect(await fetchByDoi("10.1/x", boom)).toBeNull();
  });
});

describe("fetchByArxiv", () => {
  it("maps atom xml to PaperMeta", async () => {
    const meta = await fetchByArxiv("1706.03762", fakeFetch(arxivXml));
    expect(meta?.title).toBe("Attention Is All You Need");
    expect(meta?.creators).toEqual(["Ashish Vaswani", "Noam Shazeer"]);
    expect(meta?.year).toBe(2017);
    expect(meta?.pdfUrl).toBe("https://arxiv.org/pdf/1706.03762");
  });

  it("returns null for an arXiv Error entry (nonexistent id)", async () => {
    const errorXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/api/errors#nonexistent_id</id>
    <title>Error</title>
    <summary>nonexistent id 9999.99999</summary>
    <author><name>arXiv api</name></author>
  </entry>
</feed>`;
    expect(await fetchByArxiv("9999.99999", fakeFetch(errorXml))).toBeNull();
  });
});

describe("fetchByUrl", () => {
  it("maps citation meta tags to PaperMeta", async () => {
    const meta = await fetchByUrl("https://example.com/p", fakeFetch(pageHtml));
    expect(meta?.title).toBe("Some Paper");
    expect(meta?.creators).toEqual(["Doe, Jane", "Smith, John"]);
    expect(meta?.year).toBe(2021);
    expect(meta?.doi).toBe("10.1000/xyz123");
    expect(meta?.pdfUrl).toBe("https://example.com/paper.pdf");
  });

  it("returns null when no citation tags", async () => {
    expect(await fetchByUrl("https://x.com", fakeFetch("<html></html>"))).toBeNull();
  });
});
