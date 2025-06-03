export default async function reservationRoutes(fastify, options) {
  // POST - Criar nova reserva
  fastify.post(
    "/reservations",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            business: { type: "string" },
            reservation: {
              type: "object",
              properties: {
                type: { type: "string" },
                language: { type: "string" },
                currency: { type: "string" },
                period: {
                  type: "object",
                  properties: {
                    start: { type: "string" },
                    end: { type: "string" },
                  },
                },
                information: { type: "string" },
                customer: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    email: { type: "string" },
                    phone: { type: "string" },
                    foreign: { type: "boolean" },
                    document: {
                      type: "object",
                      properties: {
                        type: { type: "string" },
                        number: { type: "string" },
                      },
                    },
                    gender: { type: "string" },
                    country: { type: "string" },
                  },
                },
              },
            },
          },
          required: ["business", "reservation"],
        },
      },
    },
    async (request, reply) => {
      const connection = await fastify.mysql.getConnection();

      try {
        await connection.beginTransaction();

        const { business, reservation } = request.body;

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

        // Verificar/inserir customer
        let customerId;
        const [existingCustomer] = await connection.execute(
          "SELECT id FROM customers WHERE email = ?",
          [reservation.customer.email],
        );

        if (existingCustomer.length > 0) {
          customerId = existingCustomer[0].id;
        } else {
          const [customerResult] = await connection.execute(
            `
          INSERT INTO customers (first_name, last_name, email, phone, foreign_customer, 
                               document_type, document_number, gender, country)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
            [
              reservation.customer.firstName,
              reservation.customer.lastName,
              reservation.customer.email,
              reservation.customer.phone || null,
              reservation.customer.foreign || false,
              reservation.customer.document?.type || null,
              reservation.customer.document?.number || null,
              reservation.customer.gender || null,
              reservation.customer.country || null,
            ],
          );
          customerId = customerResult.insertId;
        }

        // Gerar dados da reserva
        const identifier = `SALE${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}${String(new Date().getDate()).padStart(2, "0")}${String(Date.now()).slice(-8)}`;
        const hash = generateHash();

        // Inserir reserva
        const [reservationResult] = await connection.execute(
          `
        INSERT INTO reservations (business_id, identifier, hash, status, type, language, 
                                currency, information, period_start, period_end, customer_id, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
          [
            business,
            identifier,
            hash,
            "confirmed",
            reservation.type || "sale",
            reservation.language || "pt-br",
            reservation.currency || "BRL",
            reservation.information || "",
            reservation.period.start,
            reservation.period.end,
            customerId,
            new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          ],
        );

        const reservationId = reservationResult.insertId;

        // Calcular e inserir totais
        const totals = calculateTotals(reservation);
        await connection.execute(
          `
        INSERT INTO reservation_totals (reservation_id, service_price, service_commission, 
                                      service_markup, client_total, company_total, grand_total)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
          [
            reservationId,
            totals.service.price,
            totals.service.commission,
            totals.service.markup,
            totals.client.total,
            totals.company.total,
            totals.total,
          ],
        );

        // Inserir PAX se houver
        if (reservation.pax) {
          for (const [paxKey, paxData] of Object.entries(reservation.pax)) {
            await connection.execute(
              `
            INSERT INTO reservation_pax (reservation_id, pax_key, is_main, first_name, 
                                       last_name, phone, email, country, document_type, 
                                       document_number, birthdate, gender, age_group)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
              [
                reservationId,
                paxKey,
                paxData.main || false,
                paxData.firstName || null,
                paxData.lastName || null,
                paxData.phone || null,
                paxData.email || null,
                paxData.country || null,
                paxData.document?.type || null,
                paxData.document?.number || null,
                paxData.birthdate || null,
                paxData.gender || null,
                paxData.ageGroup || null,
              ],
            );
          }
        }

        await connection.commit();

        // Buscar reserva completa para retorno
        const [completeReservation] = await connection.execute(
          `
        SELECT r.*, c.first_name, c.last_name, c.email as customer_email,
               rt.service_price, rt.service_commission, rt.service_markup, rt.grand_total
        FROM reservations r
        JOIN customers c ON r.customer_id = c.id
        LEFT JOIN reservation_totals rt ON r.id = rt.reservation_id
        WHERE r.id = ?
      `,
          [reservationId],
        );

        const response = {
          id: reservationId,
          type: "reservation",
          business,
          hash,
          version: 1,
          reservation: {
            id: reservationId,
            identifier,
            status: "confirmed",
            type: reservation.type || "sale",
            createdAt: completeReservation[0].created_at,
            updatedAt: completeReservation[0].updated_at,
            expiresAt: completeReservation[0].expires_at,
            customer: {
              id: customerId,
              firstName: completeReservation[0].first_name,
              lastName: completeReservation[0].last_name,
              email: completeReservation[0].customer_email,
            },
            total: {
              service: {
                price: completeReservation[0].service_price,
                commission: completeReservation[0].service_commission,
                markup: completeReservation[0].service_markup,
              },
              total: completeReservation[0].grand_total,
            },
          },
          error: "E000",
          message: "Reserva criada com sucesso",
        };

        reply.status(201).send(response);
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
