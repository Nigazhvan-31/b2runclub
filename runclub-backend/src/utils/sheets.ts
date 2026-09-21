import ExcelJS from "exceljs";
import type { Response } from "express";

/**
 * Spreadsheet exports.
 *
 * These replace a hand-rolled CSV that concatenated strings with commas. That
 * had two problems beyond the format the club asked to change: a name
 * containing a comma split into two columns unless it happened to be one of
 * the two fields that were quoted, and a value beginning with `=` was
 * interpreted by Excel as a formula on open — a member could have named a
 * guest `=HYPERLINK(...)` and had it execute on the organiser's machine.
 *
 * ExcelJS writes a real .xlsx, so quoting is not something that can be got
 * wrong, and a string cell is stored as a string rather than as text Excel
 * re-parses on open — which disposes of both problems at once.
 */

/**
 * A cell's text.
 *
 * Deliberately *not* apostrophe-prefixed against formula injection. That guard
 * belongs to CSV, where Excel parses every field on import and a leading `=`
 * becomes a formula; in a real .xlsx a string cell is written as a string and
 * is never evaluated, so the prefix protects against nothing here.
 *
 * It did active harm: every mobile number is E.164 and so starts with `+`,
 * which matched the guard — the whole Mobile column came out as `'+9198…`,
 * apostrophe visible, and no longer pasteable into WhatsApp, which is the one
 * job this file has.
 */
function cellText(value: unknown): string {
    if (value === null || value === undefined) return "";
    return String(value);
}

export interface SheetColumn {
    header: string;
    /** Column width in characters. */
    width?: number;
}

/**
 * Builds a one-sheet workbook and streams it as an .xlsx download.
 *
 * Rows are arrays rather than objects so the caller decides column order once,
 * next to the headers, rather than relying on key order surviving a refactor.
 */
export async function sendWorkbook(
    res: Response,
    options: {
        filename: string;
        sheetName: string;
        columns: SheetColumn[];
        rows: unknown[][];
    },
) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "B² Club";
    workbook.created = new Date();

    // Excel refuses a sheet name over 31 characters or containing []*/\?:
    const safeSheetName = options.sheetName.replace(/[[\]*/\\?:]/g, " ").slice(0, 31);
    const sheet = workbook.addWorksheet(safeSheetName);

    sheet.columns = options.columns.map((c) => ({
        header: c.header,
        width: c.width ?? Math.max(12, c.header.length + 2),
    }));

    for (const row of options.rows) {
        sheet.addRow(row.map(cellText));
    }

    // A frozen, bold header row: these files are read by scrolling through a
    // few hundred rows looking for one person.
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: options.columns.length },
    };

    res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${options.filename}"`);

    await workbook.xlsx.write(res);
    res.end();
}

/** A filename-safe slug of an event or club name, for the download. */
export function slugForFilename(text: string): string {
    return (
        text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 50) || "export"
    );
}
