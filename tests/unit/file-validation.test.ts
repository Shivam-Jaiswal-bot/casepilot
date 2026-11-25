import { describe, expect, it } from "vitest";
import { sanitizeFilename, sniffFileType, validateUpload } from "@/server/documents/file-validation";
import { AppError } from "@/server/errors";
import { buildDocx, buildPdf } from "../support/fixtures";

const MAX = 5 * 1024 * 1024;

describe("sniffFileType", () => {
  it("detects PDFs from their header", async () => {
    expect(sniffFileType(await buildPdf([["Hello"]]))).toBe("pdf");
  });

  it("detects DOCX by ZIP signature plus word/document.xml entry", async () => {
    expect(sniffFileType(await buildDocx("T", [{ heading: "H", paragraphs: ["p"] }]))).toBe("docx");
  });

  it("rejects a plain ZIP that is not a Word document", () => {
    const zipLike = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("xl/workbook.xml")]);
    expect(sniffFileType(zipLike)).toBeNull();
  });

  it("rejects arbitrary bytes", () => {
    expect(sniffFileType(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
  });
});

describe("validateUpload", () => {
  it("accepts a valid PDF and derives a title", async () => {
    const result = validateUpload({ filename: "Acme MSA v2.pdf", data: await buildPdf([["x"]]), maxBytes: MAX });
    expect(result).toMatchObject({ fileType: "pdf", mimeType: "application/pdf", title: "Acme MSA v2" });
  });

  it("does not trust the extension: HTML renamed to .pdf is rejected", () => {
    expect(() => validateUpload({ filename: "evil.pdf", data: Buffer.from("<html></html>"), maxBytes: MAX })).toThrow(
      /Only PDF and Word/,
    );
  });

  it("rejects content/extension mismatches", async () => {
    const pdf = await buildPdf([["x"]]);
    expect(() => validateUpload({ filename: "contract.docx", data: pdf, maxBytes: MAX })).toThrow(/does not match/);
  });

  it("rejects empty and oversized files with the right error codes", async () => {
    const empty = () => validateUpload({ filename: "a.pdf", data: Buffer.alloc(0), maxBytes: MAX });
    expect(empty).toThrow(AppError);
    try {
      validateUpload({ filename: "a.pdf", data: await buildPdf([["x"]]), maxBytes: 10 });
    } catch (e) {
      expect((e as AppError).code).toBe("PAYLOAD_TOO_LARGE");
    }
  });

  it("sanitises path components and control characters from filenames", () => {
    expect(sanitizeFilename("../../etc/pass\u0000wd.pdf")).toBe("passwd.pdf");
    expect(sanitizeFilename('C:\\Users\\x\\"quote".pdf')).toBe("quote.pdf");
  });
});
