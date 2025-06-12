import { reservationSchema } from "../../schema/reservation.js";
import { loadErrorMessages } from "../../index.js";
import {
  getServiceUpdateQuery,
  getUpdatedService,
  prepareReservationUpdateData,
  updateFlightService,
  updateInsuranceService,
  updateMeetingService,
  updateNoteService,
  updateRentalService,
  updateRoomService,
  updateTicketService,
  updateTourService,
  updateTransferService,
  validateReservationForUpdate,
} from "./service.js";
import { checkDuplicateService } from "../reservation/services.js";

// Função para modificar reservas existentes
export default async function modificationRoutes(fastify, options) {
  // PUT - Modificar reserva existente
  fastify.put(
    "/modification/:id", // Adicionado parâmetro ID
    // {
    //   schema: {
    //     params: {
    //       type: "object",
    //       properties: {
    //         id: { type: "integer" }
    //       },
    //       required: ["id"]
    //     },
    //     body: reservationSchema,
    //     response: {
    //       200: {
    //         type: "object",
    //         properties: {
    //           id: { type: "integer" },
    //           type: { type: "string" },
    //           business: { type: "string" },
    //           hash: { type: "string" },
    //           version: { type: "integer" },
    //           reservation: { type: "object" },
    //           error: { type: "string" },
    //           message: { type: "string" },
    //         },
    //       },
    //     },
    //   },
    // },
    async (request, reply) => {
      const connection = await fastify.mysql.getConnection();
      const messages = await loadErrorMessages("pt-BR");

      try {
        await connection.beginTransaction();

        const reservationId = +request.params.id;

        let {
          business,
          reservation,
          room = [],
          transfer = [],
          tour = [],
          ticket = [],
          insurance = [],
          flight = [],
          rental = [],
          note = [],
          meeting = [],
        } = request.body;

        // Verificar se a reserva existe
        const existingReservation = await getUpdatedService(
          connection,
          reservationId,
        );
        if (!existingReservation) {
          await connection.rollback();
          return {
            id: reservationId,
            type: "reservation",
            business: business || null,
            hash: null,
            version: null,
            reservation: null,
            services: [],
            error: "E117", // Reserva não encontrada
            message: messages["E117"] || "Reserva não encontrada",
          };
        }

        // Valida a reserva antes de qualquer operação
        const validateError = await validateReservationForUpdate(connection,reservationId, business);
        if (validateError) {
          await connection.rollback();
          return {
            id: reservationId,
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

        // Verifica duplicidade (excluindo a própria reserva)
        const duplicateCheck = await checkDuplicateService(
          connection,
          reservation.identifier,
          business,
          reservationId, // Excluir a reserva atual da verificação
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
        const newVersion = (existingReservation.version || 0) + 1;

        const reservationData = prepareReservationUpdateData(
          business,
          reservation,
          hash,
          newVersion,
        );

        // Atualizar a reserva existente ao invés de inserir nova
        const { query, values } = getServiceUpdateQuery(
          reservationData,
          reservationId,
        );
        const [result] = await connection.query(query, [
          ...values,
          reservationId,
        ]);

        if (result.affectedRows === 0) {
          await connection.rollback();
          return {
            id: reservationId,
            type: "reservation",
            business: business,
            hash: null,
            version: null,
            reservation: null,
            error: "E118", // Falha ao atualizar
            services: [],
            message: messages["E118"] || "Falha ao atualizar reserva",
          };
        }

        const updatedReservation = await getUpdatedService(
          connection,
          reservationId,
        );

        if (!updatedReservation) {
          await connection.rollback();
          return {
            id: reservationId,
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

        // Processar serviços
        const modifiedServices = [];
        const failedServices = [];

        const serviceHandlers = {
          room: updateRoomService,
          transfer: updateTransferService,
          tour: updateTourService,
          ticket: updateTicketService,
          insurance: updateInsuranceService,
          flight: updateFlightService,
          rental: updateRentalService,
          note: updateNoteService,
          meeting: updateMeetingService,
        };

        const allServices = {
          room,
          transfer,
          tour,
          ticket,
          insurance,
          flight,
          rental,
          note,
          meeting,
        };

        for (const [type, services] of Object.entries(allServices)) {
          if (!Array.isArray(services) || services.length === 0) continue;
          const handler = serviceHandlers[type];
          if (!handler) continue;

          for (const serviceItem of services) {
            try {
              const result = await handler(
                connection,
                business,
                reservationId,
                serviceItem,
                "modify", // Flag para indicar que é uma modificação
              );

              if (result.success) {
                modifiedServices.push({
                  id: result.id,
                  identifier: serviceItem.identifier,
                  service: result.service,
                  status: "S123", // Status para modificação bem-sucedida
                  message: messages["S123"] || "Serviço modificado com sucesso",
                });
              } else {
                failedServices.push({
                  identifier: serviceItem.identifier,
                  error: "E119", // Erro ao modificar serviço
                  message: messages["E119"] || "Falha ao modificar serviço",
                });
              }
            } catch (err) {
              failedServices.push({
                identifier: serviceItem.identifier,
                error: "E107",
                message: messages["E107"],
              });
            }
          }
        }

        // Se há falhas críticas, fazer rollback
        if (failedServices.length > 0 && modifiedServices.length === 0) {
          await connection.rollback();
          return {
            id: reservationId,
            type: "reservation",
            business,
            hash: null,
            version: null,
            reservation: null,
            error: "E107",
            message: messages["E107"],
            services: failedServices,
          };
        }

        // Finaliza a transação
        await connection.commit();

        return {
          id: reservationId,
          type: "reservation",
          business: business,
          hash: hash,
          version: newVersion,
          reservation,
          status: failedServices.length > 0 ? "S124" : "S125", // Parcial ou total
          message:
            failedServices.length > 0
              ? messages["S124"] || "Reserva modificada com algumas falhas"
              : messages["S125"] || "Reserva modificada com sucesso",
          services: modifiedServices,
          failed_services:
            failedServices.length > 0 ? failedServices : undefined,
        };
      } catch (error) {
        await connection.rollback();
        return {
          id: request.params.id || null,
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
