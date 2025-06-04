import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getErrorMessage(statusCode, language = "pt-BR") {
  try {
    const errorFile = path.join(__dirname, "error", `${language}.json`);
    const errors = JSON.parse(fs.readFileSync(errorFile, "utf8"));
    return errors[statusCode] || errors["500"];
  } catch (error) {
    return {
      code: "INTERNAL_ERROR",
      message: "Erro interno do servidor",
    };
  }
}
