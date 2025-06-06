import { reservationSchema } from "../../schema/reservation.js";
import { loadErrorMessages } from "../../index.js";
import {
  checkDuplicateReservation,
  generateHash,
  getInsertedReservation,
  getInsertQuery,
  prepareReservationData,
  validateReservation,
} from "./reservation.js";
import { createRoomService } from "./room.js";


// Função para criar nova reservas
export default async function reservationRoutes(fastify, options) {
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
      // Conecta ao banco de dados
      const connection = await fastify.mysql.getConnection();
      const messages = await loadErrorMessages("pt-BR");
      try {
        // Inicia a transação
        await connection.beginTransaction();

        let { business, reservation, room = [] } = request.body;
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

        // Verifica se já existe uma reserva com o mesmo identifier
        const duplicateCheck = await checkDuplicateReservation(
          connection,
          reservation.identifier,
          business,
        );
        if (duplicateCheck) {
          await connection.rollback();
          return {
            id: duplicateCheck.IDMO, // Retorna o ID da reserva existente
            type: "reservation",
            business: business,
            hash: duplicateCheck.Hash || null, // Retorna o hash existente
            version: duplicateCheck.Version || null, // Retorna a versão existente
            reservation: null,
            error: "E115",
            services: [],
            message: messages["E115"],
          };
        }

        const hash = generateHash();

        // Prepara os dados da reserva
        const reservationData = prepareReservationData(
          business,
          reservation,
          hash,
        );

        // Insere a reserva (apenas uma vez)
        const [result] = await connection.query(
          getInsertQuery(),
          reservationData,
        );

        // Verifica se a inserção foi bem-sucedida
        if (!result.insertId) {
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

        // Resgata os dados completos da reserva inserida
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

        // Array para armazenar os serviços criados
        const createdServices = [];
        const failedServices = [];

        // Cria os serviços
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

        if (failedServices.length > 0) {
          return {
            id: insertedReservation.IDMO,
            type: "reservation",
            business: business,
            hash: hash,
            version: 1,
            reservation,
            status: "S121",
            message: messages["S121"],
            services: createdServices,
          };
        }

        // Prepara o objeto de resposta final
        return {
          id: insertedReservation.IDMO, // USA O IDMO DA TABELA, NÃO O result.insertId
          type: "reservation",
          business: business,
          hash: hash,
          version: 1,
          reservation,
          status: "S121",
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
