import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import reservationRoutes from "./features/reservation/index.js";
import { pool, testConnection } from "./config/database.js";
import { promises as fs } from "fs";
import * as path from "path";
import GCSClient from "./features/google/index.js";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import swaggerDocs from "../swagger.json" assert { type: "json" }; // eslint-disable-line;

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
const gcs = new GCSClient();
// Decorar Fastify com GCS
fastify.decorate("gcs", gcs);

const VALID_TYPES = ["reservation"];

const API_HANDLERS = {
  reservation: reservationRoutes,
};

await fastify.register(swagger, {
  mode: "static",
  specification: {
    document: swaggerDocs, // usa seu arquivo JSON existente
  },
});

// Registra o Swagger UI
await fastify.register(swaggerUI, {
  routePrefix: "/v2/docs",
  uiConfig: {
    docExpansion: "full",
    deepLinking: false,
  },
});

export async function loadErrorMessages(lang) {
  const filePath = path.join(
    process.cwd(),
    "/booking/utils/error",
    `${lang}.json`,
  );

  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error(`Erro ao carregar mensagens de erro para '${lang}':`, err);
    return {};
  }
}

function getLanguageFromRequest(request) {
  const lang = request.headers["accept-language"];
  return ["pt-BR", "en-US"].includes(lang) ? lang : "pt-BR";
}

fastify.register(reservationRoutes, { prefix: "/v2" });
//fastify.register(modificationRoutes, { prefix: "/v2" });

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
    console.log(`Swagger UI: http://localhost:${3000}/v2/docs`);  
  } catch (error) {
    throw new Error(error);
  }
};

start();
