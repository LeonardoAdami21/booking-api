import { reservationSchema } from "../schema/reservationSchema.js";

export default async function reservationRoutes(fastify, options) {
  // POST - Criar nova reserva
  fastify.post(
    "/reservations",
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

      try {
        await connection.beginTransaction();

        const { business, reservation } = request.body;
        const version = 1;
        const hash = generateHash(); // You need to implement this function

        // Validações de data (mesmo código anterior)
        const startDate = new Date(reservation.period.start);
        const endDate = new Date(reservation.period.end);
        const today = new Date();

        if (startDate < today) {
          return reply.status(400).send({
            id: null,
            type: "reservation",
            business,
            hash: null,
            version: null,
            reservation: null,
            error: "E001",
            message: "Data de início não pode ser no passado",
          });
        }

        const values = [
          new Date(), // Created
          new Date(), // Imported
          reservation.expiresAt ? new Date(reservation.expiresAt) : null, // Expiration
          reservation.confirmation ? new Date(reservation.confirmation) : null, // Confirmation
          business.toString(), // Business
          reservation.id, // IDIndex
          version, // Version
          reservation.identifier, // Identifier
          hash, // Hash
          reservation.language || "pt-br", // Language
          reservation.status, // Status
          reservation.type, // Type
          new Date(reservation.period.start), // StartDate
          new Date(reservation.period.end), // EndDate
          reservation.channel?.name || "unknown", // Channel
          reservation.locator || null, // Locator
          reservation.company.id, // IDCompany
          reservation.company.name, // Company
          reservation.client.id, // IDClient
          reservation.client.name, // Client
          reservation.agent.id, // IDAgent
          `${reservation.agent.firstName} ${reservation.agent.lastName}`, // Agent
          reservation.manager.id, // IDManager
          `${reservation.manager.firstName} ${reservation.manager.lastName}`, // Manager
          reservation.attendant?.id || null, // IDAttendant
          reservation.attendant
            ? `${reservation.attendant.firstName} ${reservation.attendant.lastName}`
            : null, // Attendant
          reservation.user.id, // IDUser
          `${reservation.user.firstName} ${reservation.user.lastName}`, // User
          reservation.customer.id, // IDCustomer
          `${reservation.customer.firstName} ${reservation.customer.lastName}`, // Customer
          0.0, // CostPayment
          reservation.total.service.price || 0.0, // Price
          reservation.total.service.discount || 0.0, // Discount
          reservation.total.service.tax || 0.0, // Taxes
          reservation.total.service.markup || 0.0, // Markup
          reservation.total.service.commission || 0.0, // Commission
          reservation.total.service.price || 0.0, // Cost
          0.0, // Rav
          reservation.total.total || 0.0, // Total
          reservation.information || "", // Information
          "", // Notes
        ];

        const [result] = await connection.query(
          `INSERT INTO \`ORDER\` (
            Created, Imported, Expiration, Confirmation,
            Business, IDIndex, Version, Identifier, Hash, Language,
            Status, Type, StartDate, EndDate, Channel,
            Locator, IDCompany, Company, IDClient, Client,
            IDAgent, Agent, IDManager, Manager, IDAttendant, Attendant,
            IDUser, User, IDCustomer, Customer,
            CostPayment, Price, Discount, Taxes, Markup, Commission,
            Cost, Rav, Total, Information, Notes
          ) VALUES (?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?)`,
          values, // Pass the values array here
        );

        await connection.commit();

        return reply.status(201).send({
          id: result.insertId,
          type: "reservation",
          business: business,
          hash: hash,
          version: 1,
          reservation,
          error: "E000",
          message: "Reserva criada com sucesso",
        });
      } catch (error) {
        await connection.rollback();
        fastify.log.error(error);
        reply.status(500).send({
          id: null,
          type: "reservation",
          business: request.body?.business || null,
          hash: null,
          version: null,
          reservation: null,
          error: "E999",
          message: "Erro interno do servidor",
        });
      } finally {
        connection.release();
      }
    },
  );
}

function generateHash() {
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
}

function calculateTotals(reservation) {
  const basePrice = 1000;
  const days = Math.ceil(
    (new Date(reservation.period.end) - new Date(reservation.period.start)) /
      (1000 * 60 * 60 * 24),
  );
  const servicePrice = basePrice * days;
  const commission = servicePrice * 0.15;
  const markup = servicePrice * 0.25;
  const total = servicePrice + commission + markup;

  return {
    service: {
      price: servicePrice,
      commission,
      markup,
      tax: 0,
      discount: 0,
      total,
    },
    client: { total: commission },
    company: { total: markup },
    total,
  };
}
