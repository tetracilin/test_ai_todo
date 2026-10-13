// Parses a unified git diff into one record per file for scripts/agent-guard.mjs.
//
// Hunk bodies are walked using the line counts in each "@@" header, so a content
// line such as "--- a/x" (a removed line whose text starts with "-- ") is never
// mistaken for a file header.

const DEV_NULL = "/dev/null";

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
    status: "modified",
    mode: null,
    binary: false,
    added: 0,
    removed: 0,
    addedLines: [],
    removedLines: [],
  };
}

function parseDiffHeader(line, record) {
  const quoted = /^diff --git ("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*"|\S+)$/.exec(line);
  if (quoted) {
    record.oldPath = stripSide(quoted[1]);
    record.newPath = stripSide(quoted[2]);
    return;
  }
  const spaced = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  if (spaced) {
    record.oldPath = spaced[1];
    record.newPath = spaced[2];
  }
}

export function parsePatch(text) {
  const files = [];
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  let current = null;
  let oldLeft = 0;
  let newLeft = 0;

  for (const line of lines) {
    if (current && (oldLeft > 0 || newLeft > 0)) {
      const marker = line[0];
      if (marker === "\\") continue;
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
      continue;
    }

    if (line.startsWith("diff --git ")) {
      current = newRecord();
      parseDiffHeader(line, current);
      files.push(current);
      continue;
    }
    if (!current) continue;

    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      newLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
      continue;
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
      current.oldPath = unquote(line.slice("rename from ".length));
    } else if (line.startsWith("rename to ")) {
      current.status = "renamed";
      current.newPath = unquote(line.slice("rename to ".length));
    } else if (line.startsWith("--- ")) {
      current.oldPath = stripSide(line.slice(4));
    } else if (line.startsWith("+++ ")) {
      current.newPath = stripSide(line.slice(4));
    } else if (line.startsWith("GIT binary patch") || line.startsWith("Binary files ")) {
      current.binary = true;
    }
  }

  for (const record of files) {
    if (record.status === "added") record.oldPath = null;
    if (record.status === "deleted") record.newPath = null;
    record.path = record.newPath ?? record.oldPath;
  }
  return files;
}
