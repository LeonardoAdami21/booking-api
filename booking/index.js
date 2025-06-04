import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import reservationRoutes from "./reservations/reservation.js";
import { pool, testConnection } from "./config/database.js";
import { getErrorMessage } from "./utils/error.js";

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

fastify.register(reservationRoutes, { prefix: "/v2" });

fastify.setErrorHandler((error, request, reply) => {
  const lang = request.headers["accept-language"]?.includes("pt")
    ? "pt-br"
    : "en-us";

  const errorResponse = getErrorMessage(error.statusCode || 500, lang);

  reply.status(error.statusCode || 500).send({
    success: false,
    error: errorResponse,
    message: error.message,
  });
});

const start = async () => {
  try {
    const dbConnected = await testConnection();
    if (!dbConnected) {
      console.error(
        "❌ Falha ao conectar com o banco. Servidor não será iniciado.",
      );
      process.exit(1);
    }
    await fastify.listen({ port: 3000, host: "0.0.0.0" });
    console.log(`Server running on port http://localhost:${3000}/v2`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
