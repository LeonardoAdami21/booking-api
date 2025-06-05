import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import reservationRoutes from "./features/reservation/index.js";
import { pool, testConnection } from "./config/database.js";
import { getErrorMessage } from "./utils/error.js";
import fs from "fs/promises";
import * as path from "path";

const fastify = Fastify({
  logger: true,
});
// Middleware para CORS
fastify.register(cors, {
  origin: true,
});

fastify.decorate("mysql", pool);

// Middleware para parsing JSON
fastify.register(formbody);

const VALID_TYPES = ["reservation"];

const API_HANDLERS = {
  reservation: reservationRoutes,
};


async function loadErrorMessages(lang) {
  const filePath = path.join(process.cwd(), "language", `${lang}.json`);
  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data);
  } catch {
    const fallback = await fs.readFile(
      path.join(process.cwd(), "language", "pt-BR.json"),
      "utf8",
    );
    return JSON.parse(fallback);
  }
}

// Hook para bloquear métodos diferentes de POST
fastify.addHook("preHandler", async (request, reply) => {
  if (request.method !== "POST") {
    const lang = getLanguageFromRequest(request);
    const messages = await loadErrorMessages(lang);
    return reply.code(405).send({
      error: "E001",
      message: messages["E001"],
    });
  }
});

function getLanguageFromRequest(request) {
  const lang = request.headers["accept-language"];
  return ["pt-BR", "en-US"].includes(lang) ? lang : "pt-BR";
}

fastify.register(reservationRoutes, { prefix: "/v2" });

fastify.post("/v2/:type", async (request, reply) => {
  const lang = getLanguageFromRequest(request);
  const messages = await loadErrorMessages(lang);
  const { type } = request.params;
  const { key, ...rest } = request.body || {};

  if (!VALID_TYPES.includes(type)) {
    return reply.code(400).send({
      error: "E003",
      message: messages["E003"],
    });
  }

  if (!key) {
    return reply.code(400).send({
      error: "E004",
      message: messages["E004"],
    });
  }

  try {
    const payload = {
      type: type,
      [type]: rest,
    };

    const response = await axios.post(payload, {
      headers: {
        "Content-Type": "application/json",
        "Accept-Language": lang,
      },
      timeout: 30000,
    });

    return reply.code(response.status).send(response.data);
  } catch (error) {
    fastify.log.error("VM - Erro ao processar requisição:", error.message);

    if (error.response) {
      return reply.code(error.response.status).send(error.response.data);
    }

    if (["ECONNABORTED", "ENOTFOUND"].includes(error.code)) {
      return reply.code(503).send({
        error: "E007",
        message: messages["E007"],
      });
    }

    return reply.code(500).send({
      error: "E006",
      message: messages["E006"],
    });
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: "0.0.0.0" });
    console.log(`Server running on port http://localhost:${3000}/v2`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
