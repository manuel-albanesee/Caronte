const { readFileSync } = require("node:fs");

const fields = ["OBIETTIVO", "INPUT", "FATTI", "VINCOLI", "USCITA", "VERIFICA"];
const required = new Set(["OBIETTIVO", "USCITA", "VERIFICA"]);
const heading = new RegExp(`^(${fields.join("|")}):[ \\t]*`, "gm");

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
}

function checkBrief(prompt) {
  const text = typeof prompt === "string" ? prompt.replace(/\r\n/g, "\n").trim() : "";
  const sections = [...text.matchAll(heading)];

  if (sections.length !== fields.length || sections[0].index !== 0 ||
      sections.some((section, index) => section[1] !== fields[index])) {
    return `Usa una sola volta, a inizio riga e in ordine: ${fields.map((field) => `${field}:`).join(" ")}. Compila i fatti necessari, i riferimenti e il criterio di arresto.`;
  }

  const incomplete = sections.filter((section, index) => {
    const start = section.index + section[0].length;
    const end = sections[index + 1]?.index ?? text.length;
    const value = text.slice(start, end).trim();
    return !value || (required.has(section[1]) && /^nessuno\.?$/i.test(value));
  });

  if (incomplete.length) {
    return `Completa i campi incompleti del brief: ${incomplete.map((section) => section[1]).join(", ")}. Usa "nessuno" solo per INPUT, FATTI o VINCOLI se assenti.`;
  }
}

const event = JSON.parse(readFileSync(0, "utf8").replace(/^\uFEFF/, ""));
if (event.tool_name === "Agent" || event.tool_name === "Task") {
  const problem = checkBrief(event.tool_input?.prompt);
  if (problem) deny(problem);
}
