import { loadErrorMessages } from "../../index.js";
import GCSClient from "../google/index.js";
import {
  getInsertedReservation,
  getInsertQuery,
  prepareReservationData,
  validateReservation,
} from "./helper.js";
import {
  createFlightService,
  createInsuranceService,
  createRentalService,
  createRoomService,
  createTicketService,
  createTourService,
  createTransferService,
} from "./services.js";
const gcs = new GCSClient();
// Função para criar e gerenciar reservas
export default async function reservationRoutes(fastify, options) {
  // POST - Criar nova reserva
  fastify.post(
    "/reservation",
    // {
    //   schema: {
    //     body: reservationSchema,
    //     response: {
    //       201: {
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

        let { business, version, reservation } = request.body;
        let roomServices = reservation.room.length > 0 ? reservation.room : [];
        let transferServices =
          reservation.transfer.length > 0 ? reservation.transfer : [];
        let tourServices = reservation.tour.length > 0 ? reservation.tour : [];
        let ticketServices =
          reservation.ticket.length > 0 ? reservation.ticket.length : [];
        let insuranceServices =
          reservation.insurance.length > 0 ? reservation.insurance : [];
        let flightServices =
          reservation.flight.length > 0 ? reservation.flight : [];
        let rentalServices =
          reservation.rental.length > 0 ? reservation.rental : [];

        // Valida a reserva antes de qualquer operação

        const validateReservationData = await validateReservation(reservation);
        if (validateReservationData.error) {
          await connection.rollback();
          return {
            type: "reservation",
            business: business,
            reservation: null,
            error: "E112",
            message: messages["E112"],
          };
        }

        const reservationData = prepareReservationData(
          business,
          version,
          reservation,
        );

        // Usa a função dinâmica para inserir
        const { query, values } = getInsertQuery(reservationData);
        const [result] = await connection.query(query, values);

        if (!result.insertId) {
          await connection.rollback();
          return {
            type: "reservation",
            business: business,
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
            type: "reservation",
            business: business,
            reservation: null,
            error: "E116",
            message: messages["E116"],
          };
        }

        // Processa serviços de quarto
        const createdServices = [];
        const failedServices = [];

        const serviceHandlers = {
          room: createRoomService,
          transfer: createTransferService,
          tour: createTourService,
          ticket: createTicketService,
          insurance: createInsuranceService,
          flight: createFlightService,
          rental: createRentalService,
        };

        const allServices = {
          room: roomServices,
          transfer: transferServices,
          tour: tourServices,
          ticket: ticketServices,
          insurance: insuranceServices,
          flight: flightServices,
          rental: rentalServices,
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
                insertedReservation.IDMO,
                serviceItem,
                reservation.pax,
              );
              if (result.status) {
                createdServices.push({
                  id: result.IDMO,
                  identifier: serviceItem.identifier,
                  service: result.service,
                  status: "S122",
                  message: messages["S122"],
                });
              } else {
                failedServices.push({
                  identifier: serviceItem.identifier,
                  error: "E107",
                  message: messages["E107"],
                });
              }
            } catch (err) {
              await connection.rollback();
              return {
                type: "reservation",
                business,
                reservation: null,
                error: "E107",
                message: messages["E107"],
              };
            }
          }
        }

        const backupData = {
          timestamp: new Date().toISOString(),
          business,
          reservation,
          ip: request.ip,
          userAgent: request.headers["user-agent"],
        };

        const backupFileName = `${version}`;
        await gcs.saveJSON(
          backupData,
          backupFileName,
          `order/${insertedReservation.IDMO}`,
        );

        // Finaliza a transação
        await connection.commit();

        return {
          type: "reservation",
          backup: backupFileName,
          version: 1,
          reservation: {
            createdServices,
          },
          status: failedServices.length > 0 ? "S121" : "S121",
          message: messages["S121"],
        };
      } catch (error) {
        await connection.rollback();
        return {
          type: "reservation",
          reservation: null,
          error: "E107",
          message: messages["E107"],
        };
      } finally {
        connection.release();
      }
    },
  );
}
