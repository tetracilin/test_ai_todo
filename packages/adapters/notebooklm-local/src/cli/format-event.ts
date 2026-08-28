// SCAFFOLD ONLY (NLM-A03): no real `nlm` event formatting yet (see NLM-A08
// "event/result formatting and tests for success, raw output, auth failure,
// timeout, and truncation"). Prints the raw line so the package
// builds/typechecks with the expected export shape.
export function formatNotebookLmLocalStdoutEvent(line: string, _debug: boolean): void {
  console.log(line);
}
