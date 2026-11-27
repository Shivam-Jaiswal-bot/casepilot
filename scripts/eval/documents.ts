import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { EvalContract } from "./dataset";

/** Renders dataset contracts into real PDF / DOCX files so evaluation exercises the actual extractors. */

async function buildPdf(pages: string[][]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const paragraphs of pages) {
    const page = pdf.addPage([612, 792]);
    let y = 740;
    for (const para of paragraphs) {
      let line = "";
      for (const word of para.split(" ")) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, 10) > 500 && line) {
          page.drawText(line, { x: 56, y, size: 10, font });
          y -= 14;
          line = word;
        } else line = next;
      }
      if (line) page.drawText(line, { x: 56, y, size: 10, font });
      y -= 24;
    }
  }
  return Buffer.from(await pdf.save());
}

async function buildDocx(title: string, sections: { heading: string; paragraphs: string[] }[]): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
          ...sections.flatMap((s) => [new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_1 }), ...s.paragraphs.map((p) => new Paragraph({ text: p }))]),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

export async function renderContract(contract: EvalContract): Promise<{ filename: string; data: Buffer }> {
  if (contract.format === "pdf") return { filename: `${contract.title}.pdf`, data: await buildPdf(contract.pages ?? []) };
  return { filename: `${contract.title}.docx`, data: await buildDocx(contract.title, contract.sections ?? []) };
}
