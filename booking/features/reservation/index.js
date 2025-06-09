import { reservationSchema } from "../../schema/reservation.js";
import { loadErrorMessages } from "../../index.js";
import {
  checkDuplicateReservation,
  generateHash,
  getInsertedReservation,
  getInsertQuery,
  prepareReservationData,
  validateReservation,
} from "./helper.js";
import { createRoomService } from "./services.js";

// Função para criar e gerenciar reservas
export default async function reservationRoutes(fastify, options) {
  // POST - Criar nova reserva
  fastify.post(
    "/reservation",
    {
      schema: {
        body: reservationSchema,
        response: {
          201: {
            type: "object",
            properties: {
              id: { type: "integer" },
              type: { type: "string" },
              business: { type: "string" },
              hash: { type: "string" },
              version: { type: "integer" },
              reservation: { type: "object" },
              error: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const connection = await fastify.mysql.getConnection();
      const messages = await loadErrorMessages("pt-BR");

      try {
        await connection.beginTransaction();

        let {
          business,
          reservation,
          room = [],
          tour = [],
          transfer = [],
          ticket = [],
          insurance = [],
          flight = [],
          rental = [],
          note = [],
          meeting = [],
        } = request.body;
        const roomServices = room.length > 0 ? room : [];

        // Valida a reserva antes de qualquer operação
        const validateError = validateReservation(reservation);
        if (validateError) {
          await connection.rollback();
          return {
            id: null,
            type: "reservation",
            business: business || null,
            hash: null,
            version: null,
            reservation: null,
            services: [],
            error: "E114",
            message: messages["E114"],
          };
        }

        // Verifica duplicidade
        const duplicateCheck = await checkDuplicateReservation(
          connection,
          reservation.identifier,
          business,
        );

        if (duplicateCheck) {
          await connection.rollback();
          return {
            id: duplicateCheck.id,
            type: "reservation",
            business: business,
            hash: duplicateCheck.hash,
            version: duplicateCheck.version,
            reservation: null,
            error: "E115",
            services: [],
            message: messages["E115"],
          };
        }

        const hash = generateHash();
        const reservationData = prepareReservationData(
          business,
          reservation,
          hash,
        );

        // Usa a função dinâmica para inserir
        const { query, values } = getInsertQuery(reservationData);
        const [result] = await connection.query(query, values);

        if (!result.insertId) {
          await connection.rollback();
          return {
            id: null,
            type: "reservation",
            business: business,
            hash: null,
            version: null,
            reservation: null,
            error: "E116",
            services: [],
            message: messages["E116"],
          };
        }

        const insertedReservation = await getInsertedReservation(
          connection,
          result.insertId,
        );

        if (!insertedReservation) {
          await connection.rollback();
          return {
            id: null,
            type: "reservation",
            business: business,
            hash: null,
            version: null,
            reservation: null,
            error: "E116",
            services: [],
            message: messages["E116"],
          };
        }

        // Processa serviços de quarto
        const createdServices = [];
        const failedServices = [];

        if (
          roomServices &&
          Array.isArray(roomServices) &&
          roomServices.length > 0
        ) {
          for (const roomService of roomServices) {
            try {
              const serviceResult = await createRoomService(
                connection,
                business,
                insertedReservation.IDMO,
                roomService,
              );

              if (serviceResult.success) {
                createdServices.push({
                  id: serviceResult.id,
                  identifier: roomService.identifier,
                  service: serviceResult.service,
                  status: "S122",
                  message: messages["S122"],
                });
              } else {
                failedServices.push({
                  identifier: roomService.identifier,
                  error: "E107",
                  message: messages["E107"],
                });
              }
            } catch (error) {
              await connection.rollback();
              return {
                id: null,
                type: "reservation",
                business: business,
                hash: null,
                version: null,
                reservation: null,
                error: "E107",
                message: messages["E107"],
              };
            }
          }
        }

        await connection.commit();

        return {
          id: insertedReservation.IDMO,
          type: "reservation",
          business: business,
          hash: hash,
          version: 1,
          reservation,
          status: failedServices.length > 0 ? "S121" : "S121",
          message: messages["S121"],
          services: createdServices,
        };
      } catch (error) {
        await connection.rollback();
        return {
          id: null,
          type: "reservation",
          business: request.body?.business || null,
          hash: null,
          version: null,
          reservation: null,
          services: [],
          error: "E107",
          message: messages["E107"],
        };
      } finally {
        connection.release();
      }
    },
  );
}
