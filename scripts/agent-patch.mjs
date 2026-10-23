// Parses a unified git diff into one record per file for scripts/agent-guard.mjs.
//
// This parser sits on a security boundary, so it is strict:
//  - every path a file record mentions (diff header, ---/+++, rename, copy) is kept in
//    `paths`, so a later or disagreeing header can never hide a path from the guard;
//  - anything it cannot attribute to a file (text before the first "diff --git",
//    unknown headers, header lines after a hunk, a truncated hunk) is reported in
//    `problems` instead of being skipped. git itself skips such lines, so silently
//    ignoring them would let a patch change files the guard never saw.
//
// Hunk bodies are walked using the line counts in each "@@" header, so a content
// line such as "--- a/x" (a removed line whose text starts with "-- ") is never
// mistaken for a file header.

const DEV_NULL = "/dev/null";

const PLAIN_HEADERS = [
  "index ",
  "old mode ",
  "similarity index ",
  "dissimilarity index ",
];

function unquote(value) {
  const trimmed = value.replace(/\t.*$/, "").trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  return trimmed;
}

function stripSide(value) {
  const unquoted = unquote(value);
  if (unquoted === DEV_NULL) return null;
  return unquoted.replace(/^[ab]\//, "");
}

function newRecord() {
  return {
    path: null,
    oldPath: null,
    newPath: null,
    paths: [],
    status: "modified",
    mode: null,
    binary: false,
    added: 0,
    removed: 0,
    addedLines: [],
    removedLines: [],
    raw: { headerOld: null, headerNew: null, minus: null, plus: null, from: null, to: null },
  };
}

function parseDiffHeader(line, record) {
  const quoted = /^diff --git ("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*"|\S+)$/.exec(line);
  if (quoted) {
    record.raw.headerOld = stripSide(quoted[1]);
    record.raw.headerNew = stripSide(quoted[2]);
    return true;
  }
  const spaced = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  if (spaced) {
    record.raw.headerOld = spaced[1];
    record.raw.headerNew = spaced[2];
    return true;
  }
  return false;
}

function finish(record) {
  const { headerOld, headerNew, minus, plus, from, to } = record.raw;
  record.paths = [...new Set([headerOld, headerNew, minus, plus, from, to].filter(Boolean))];
  record.oldPath = from ?? minus ?? headerOld;
  record.newPath = to ?? plus ?? headerNew;
  if (record.status === "added") record.oldPath = null;
  if (record.status === "deleted") record.newPath = null;
  record.path = record.newPath ?? record.oldPath;
  delete record.raw;
}

export function parsePatchChecked(text) {
  const files = [];
  const problems = [];
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  let current = null;
  let oldLeft = 0;
  let newLeft = 0;
  let sawHunk = false;

  lines.forEach((line, index) => {
    const where = `line ${index + 1}`;

    if (current && (oldLeft > 0 || newLeft > 0)) {
      const marker = line[0];
      if (marker === "\\") return;
      if (marker === "+") {
        current.added += 1;
        current.addedLines.push(line.slice(1));
        newLeft -= 1;
      } else if (marker === "-") {
        current.removed += 1;
        current.removedLines.push(line.slice(1));
        oldLeft -= 1;
      } else {
        oldLeft -= 1;
        newLeft -= 1;
      }
      return;
    }

    if (line.startsWith("diff --git ")) {
      current = newRecord();
      sawHunk = false;
      if (!parseDiffHeader(line, current)) problems.push(`${where}: unparseable "diff --git" header`);
      files.push(current);
      return;
    }
    if (!current) {
      if (line !== "") problems.push(`${where}: content before the first "diff --git" header`);
      return;
    }
    if (line === "" || line.startsWith("\\")) return;
    if (current.binary) return; // a binary change is rejected by the guard; its body is opaque

    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      sawHunk = true;
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      newLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
      return;
    }
    if (sawHunk) {
      problems.push(`${where}: unexpected line after a hunk`);
      return;
    }

    if (line.startsWith("new file mode ")) {
      current.status = "added";
      current.mode = line.slice("new file mode ".length).trim();
    } else if (line.startsWith("deleted file mode ")) {
      current.status = "deleted";
      current.mode = line.slice("deleted file mode ".length).trim();
    } else if (line.startsWith("new mode ")) {
      current.mode = line.slice("new mode ".length).trim();
    } else if (line.startsWith("rename from ")) {
      current.status = "renamed";
      current.raw.from = unquote(line.slice("rename from ".length));
    } else if (line.startsWith("rename to ")) {
      current.status = "renamed";
      current.raw.to = unquote(line.slice("rename to ".length));
    } else if (line.startsWith("copy from ")) {
      current.status = "copied";
      current.raw.from = unquote(line.slice("copy from ".length));
    } else if (line.startsWith("copy to ")) {
      current.status = "copied";
      current.raw.to = unquote(line.slice("copy to ".length));
    } else if (line.startsWith("--- ")) {
      current.raw.minus = stripSide(line.slice(4));
    } else if (line.startsWith("+++ ")) {
      current.raw.plus = stripSide(line.slice(4));
    } else if (line.startsWith("GIT binary patch") || line.startsWith("Binary files ")) {
      current.binary = true;
    } else if (!PLAIN_HEADERS.some((prefix) => line.startsWith(prefix))) {
      problems.push(`${where}: unrecognised header line`);
    }
  });

  if (oldLeft > 0 || newLeft > 0) problems.push("the last hunk is truncated");
  files.forEach(finish);
  return { files, problems };
}

export function parsePatch(text) {
  return parsePatchChecked(text).files;
}
